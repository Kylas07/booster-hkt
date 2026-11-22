using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace BoosterApi;

public sealed record Player(int Id, string CharacterId, string Slug, string Name, bool Approved, int BonusTickets, DateOnly? LastFreeDay);

public static class Db
{
    public const string Schema = """
        CREATE TABLE IF NOT EXISTS players (
            id            serial PRIMARY KEY,
            character_id  text NOT NULL UNIQUE,
            slug          text NOT NULL DEFAULT '',
            name          text NOT NULL,
            code_hash     text NOT NULL UNIQUE,
            approved      boolean NOT NULL DEFAULT false,
            bonus_tickets integer NOT NULL DEFAULT 0 CHECK (bonus_tickets >= 0),
            last_free_day date,
            created_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS players_slug_idx ON players (lower(slug));

        CREATE TABLE IF NOT EXISTS owned_cards (
            player_id  integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            card_id    text NOT NULL,
            qty        integer NOT NULL,
            first_at   timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (player_id, card_id)
        );

        CREATE TABLE IF NOT EXISTS openings (
            id         bigserial PRIMARY KEY,
            player_id  integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            cards      text[] NOT NULL,
            used       text NOT NULL,
            at         timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS openings_player_idx ON openings (player_id, at DESC);

        CREATE TABLE IF NOT EXISTS player_slugs (
            player_id  integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            slug       text NOT NULL,
            PRIMARY KEY (player_id, slug)
        );
        CREATE INDEX IF NOT EXISTS player_slugs_slug_idx ON player_slugs (slug);
        """;

    /// <summary>Accepte une URL postgres:// (format Neon / Vercel) ou une chaîne Npgsql classique.</summary>
    public static string ToConnectionString(string url)
    {
        if (!url.StartsWith("postgres://") && !url.StartsWith("postgresql://")) return url;

        var uri = new Uri(url);
        var user = uri.UserInfo.Split(':', 2);
        var query = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(kv => kv.Split('=', 2))
            .ToDictionary(kv => kv[0].ToLowerInvariant(), kv => kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : "");

        var b = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Username = Uri.UnescapeDataString(user[0]),
            Password = user.Length > 1 ? Uri.UnescapeDataString(user[1]) : null,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            SslMode = query.TryGetValue("sslmode", out var ssl) && ssl == "disable" ? SslMode.Disable : SslMode.Require,
        };
        return b.ConnectionString;
    }

    public static NpgsqlCommand Cmd(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql, params object?[] args)
    {
        var cmd = new NpgsqlCommand(sql, conn, tx);
        foreach (var a in args) cmd.Parameters.Add(new NpgsqlParameter { Value = a ?? DBNull.Value });
        return cmd;
    }

    public static async Task<int> ExecAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql, params object?[] args)
    {
        await using var cmd = Cmd(conn, tx, sql, args);
        return await cmd.ExecuteNonQueryAsync();
    }

    public static async Task EnsureSchemaAsync(NpgsqlDataSource ds)
    {
        await using var conn = await ds.OpenConnectionAsync();
        await ExecAsync(conn, null, Schema);
    }

    // ---- Codes joueurs : on ne stocke que leur empreinte SHA-256 ----

    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I

    public static string NewCode()
    {
        var raw = RandomNumberGenerator.GetString(CodeAlphabet, 10);
        return $"{raw[..5]}-{raw[5..]}";
    }

    public static string HashCode(string code)
    {
        var normalized = new string(code.ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
    }

    private const string PlayerColumns = "id, character_id, slug, name, approved, bonus_tickets, last_free_day";

    private static Player ReadPlayer(NpgsqlDataReader r) => new(
        r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetBoolean(4), r.GetInt32(5),
        r.IsDBNull(6) ? null : r.GetFieldValue<DateOnly>(6));

    public static async Task<Player?> PlayerByCodeAsync(NpgsqlDataSource ds, string? code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 40) return null;
        await using var conn = await ds.OpenConnectionAsync();
        await using var cmd = Cmd(conn, null, $"SELECT {PlayerColumns} FROM players WHERE code_hash = $1", HashCode(code));
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? ReadPlayer(r) : null;
    }

    /// <summary>Mode ouvert : crée le joueur à sa première visite (validé d'office), met à jour son nom sinon.</summary>
    public static async Task<Player> UpsertOpenPlayerAsync(NpgsqlDataSource ds, string characterId, string slug, string name, string[]? slugs = null)
    {
        await using var conn = await ds.OpenConnectionAsync();
        Player player;
        await using (var cmd = Cmd(conn, null, $"""
            INSERT INTO players (character_id, slug, name, code_hash, approved)
            VALUES ($1, $2, $3, $4, true)
            ON CONFLICT (character_id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, approved = true
            RETURNING {PlayerColumns}
            """, characterId, slug, name, HashCode(NewCode())))
        await using (var r = await cmd.ExecuteReaderAsync())
        {
            await r.ReadAsync();
            player = ReadPlayer(r);
        }

        if (slugs is not null)
        {
            await using var tx = await conn.BeginTransactionAsync();
            await ExecAsync(conn, tx, "DELETE FROM player_slugs WHERE player_id = $1", player.Id);
            await ExecAsync(conn, tx, "INSERT INTO player_slugs (player_id, slug) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING", player.Id, slugs);
            await tx.CommitAsync();
        }
        return player;
    }

    public static async Task<Player?> PlayerByIdAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, int id)
    {
        await using var cmd = Cmd(conn, tx, $"SELECT {PlayerColumns} FROM players WHERE id = $1", id);
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? ReadPlayer(r) : null;
    }

    public static async Task<List<object>> OwnedAsync(NpgsqlConnection conn, int playerId)
    {
        var list = new List<object>();
        await using var cmd = Cmd(conn, null, "SELECT card_id, qty FROM owned_cards WHERE player_id = $1 ORDER BY card_id", playerId);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) list.Add(new { cardId = r.GetString(0), qty = r.GetInt32(1) });
        return list;
    }
}

/// <summary>Remise à zéro quotidienne du booster gratuit, à minuit heure de Paris par défaut.</summary>
public static class Clock
{
    private static readonly TimeZoneInfo Tz = Find();

    private static TimeZoneInfo Find()
    {
        var id = Environment.GetEnvironmentVariable("GAME_TIMEZONE") ?? "Europe/Paris";
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch { Console.Error.WriteLine($"Fuseau '{id}' introuvable, UTC utilisé."); return TimeZoneInfo.Utc; }
    }

    public static DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Tz));

    public static DateTime NextResetUtc() =>
        TimeZoneInfo.ConvertTimeToUtc(Today().AddDays(1).ToDateTime(TimeOnly.MinValue), Tz);
}
