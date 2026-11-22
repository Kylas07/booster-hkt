using System.Security.Cryptography;
using System.Text;
using BoosterApi;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// ---- Configuration (variables d'environnement Vercel) ----
string Env(string name) => Environment.GetEnvironmentVariable(name) ?? "";

var dbUrl = Env("DATABASE_URL") is { Length: > 0 } u ? u : Env("POSTGRES_URL");
if (dbUrl.Length == 0) throw new InvalidOperationException("DATABASE_URL manquant (ajoute Neon depuis l'onglet Storage de Vercel).");

var adminKey = Env("ADMIN_KEY");
if (adminKey.Length < 12) Console.Error.WriteLine("ADMIN_KEY absent ou trop court (12 caractères min.) : le panneau staff est désactivé.");

var origins = Env("ALLOWED_ORIGIN").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
if (origins.Length == 0) Console.Error.WriteLine("ALLOWED_ORIGIN vide : aucun site ne pourra appeler l'API.");

var autoApprove = Env("AUTO_APPROVE") == "true";
var port = Env("PORT") is { Length: > 0 } p ? p : "80";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(Db.ToConnectionString(dbUrl)));
builder.Services.AddSingleton(Catalog.Load(Path.Combine(AppContext.BaseDirectory, "cards.json")));
builder.Services.AddCors(o => o.AddDefaultPolicy(policy => policy
    .WithOrigins(origins)
    .WithHeaders("Content-Type", "X-Player-Code", "X-Admin-Key")
    .WithMethods("GET", "POST", "DELETE")));

var app = builder.Build();
app.UseCors();

await Db.EnsureSchemaAsync(app.Services.GetRequiredService<NpgsqlDataSource>());

static IResult Error(int status, string message) => Results.Json(new { error = message }, statusCode: status);

static object StatusOf(Player p)
{
    var today = Clock.Today();
    return new
    {
        characterId = p.CharacterId,
        name = p.Name,
        approved = p.Approved,
        freeAvailable = p.Approved && (p.LastFreeDay is null || p.LastFreeDay < today),
        bonusTickets = p.BonusTickets,
        nextFreeAt = Clock.NextResetUtc(),
    };
}

// =====================================================================
// Public
// =====================================================================

app.MapGet("/ping", () => "pong");

app.MapGet("/cards", (Catalog cat) => Results.Ok(cat.PublicView()));

// Collection d'un personnage, pour l'afficher sur son profil
app.MapGet("/collection/{slug}", async (string slug, NpgsqlDataSource ds, Catalog cat) =>
{
    await using var conn = await ds.OpenConnectionAsync();
    await using var cmd = Db.Cmd(conn, null,
        "SELECT id, name FROM players WHERE lower(slug) = lower($1) AND approved LIMIT 1", slug);
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return Error(404, "Ce personnage ne joue pas aux boosters.");
    var (id, name) = (r.GetInt32(0), r.GetString(1));
    await r.CloseAsync();

    var owned = await Db.OwnedAsync(conn, id);
    return Results.Ok(new { name, owned, unique = owned.Count, total = cat.Cards.Count });
});

// =====================================================================
// Joueur
// =====================================================================

// Inscription : le joueur reçoit son code tout de suite, le staff valide ensuite.
app.MapPost("/register", async (RegisterRequest req, NpgsqlDataSource ds) =>
{
    var characterId = req.CharacterId?.Trim() ?? "";
    var name = req.Name?.Trim() ?? "";
    var slug = req.Slug?.Trim() ?? "";
    if (characterId.Length is 0 or > 100 || name.Length is 0 or > 100 || slug.Length > 100)
        return Error(400, "Personnage invalide.");

    var code = Db.NewCode();
    await using var conn = await ds.OpenConnectionAsync();
    await using var cmd = Db.Cmd(conn, null, """
        INSERT INTO players (character_id, slug, name, code_hash, approved)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (character_id) DO NOTHING
        RETURNING id
        """, characterId, slug, name, Db.HashCode(code), autoApprove);
    if (await cmd.ExecuteScalarAsync() is null)
        return Error(409, "Ce personnage est déjà inscrit. Si tu as perdu ton code, demande au staff de te réinitialiser.");

    return Results.Ok(new { code, approved = autoApprove });
});

app.MapGet("/me", async (HttpContext ctx, NpgsqlDataSource ds) =>
{
    var player = await Db.PlayerByCodeAsync(ds, ctx.Request.Headers["X-Player-Code"]);
    if (player is null) return Error(401, "Code inconnu.");

    await using var conn = await ds.OpenConnectionAsync();
    return Results.Ok(new { status = StatusOf(player), owned = await Db.OwnedAsync(conn, player.Id) });
});

app.MapPost("/open", async (HttpContext ctx, NpgsqlDataSource ds, Catalog cat) =>
{
    var player = await Db.PlayerByCodeAsync(ds, ctx.Request.Headers["X-Player-Code"]);
    if (player is null) return Error(401, "Code inconnu.");
    if (!player.Approved) return Error(403, "Ton inscription attend la validation du staff.");

    await using var conn = await ds.OpenConnectionAsync();
    await using var tx = await conn.BeginTransactionAsync();

    // Consommation atomique : d'abord le booster gratuit du jour, sinon un ticket bonus.
    // Un double-clic ou deux onglets ne peuvent pas ouvrir deux fois avec le même ticket.
    string? used = null;
    if (await Db.ExecAsync(conn, tx, """
            UPDATE players SET last_free_day = $2
            WHERE id = $1 AND approved AND (last_free_day IS NULL OR last_free_day < $2)
            """, player.Id, Clock.Today()) == 1)
        used = "free";
    else if (await Db.ExecAsync(conn, tx,
            "UPDATE players SET bonus_tickets = bonus_tickets - 1 WHERE id = $1 AND approved AND bonus_tickets > 0",
            player.Id) == 1)
        used = "bonus";

    if (used is null)
    {
        await tx.RollbackAsync();
        return Error(409, "Plus de booster disponible pour aujourd'hui.");
    }

    var drawn = cat.DrawPack();
    var ids = drawn.Select(c => c.Id).ToArray();

    var totals = new Dictionary<string, int>();
    await using (var cmd = Db.Cmd(conn, tx, """
            INSERT INTO owned_cards (player_id, card_id, qty)
            SELECT $1, c, count(*)::int FROM unnest($2::text[]) AS c GROUP BY c
            ON CONFLICT (player_id, card_id) DO UPDATE SET qty = owned_cards.qty + EXCLUDED.qty
            RETURNING card_id, qty
            """, player.Id, ids))
    await using (var r = await cmd.ExecuteReaderAsync())
        while (await r.ReadAsync()) totals[r.GetString(0)] = r.GetInt32(1);

    await Db.ExecAsync(conn, tx, "INSERT INTO openings (player_id, cards, used) VALUES ($1, $2, $3)", player.Id, ids, used);
    var updated = await Db.PlayerByIdAsync(conn, tx, player.Id) ?? player;
    await tx.CommitAsync();

    // "Nouveau !" : la carte n'était pas possédée avant ce booster (marquée une seule fois)
    var inPack = ids.GroupBy(x => x).ToDictionary(g => g.Key, g => g.Count());
    var seen = new HashSet<string>();
    var cards = drawn.Select(c => new
    {
        c.Id, c.Name, c.Rarity, c.Image, c.Description, c.Finish,
        isNew = totals[c.Id] == inPack[c.Id] && seen.Add(c.Id),
    }).ToList();

    return Results.Ok(new { cards, used, status = StatusOf(updated) });
});

// =====================================================================
// Staff (en-tête X-Admin-Key)
// =====================================================================

bool IsAdmin(HttpContext ctx)
{
    if (adminKey.Length < 12) return false;
    var given = Encoding.UTF8.GetBytes(ctx.Request.Headers["X-Admin-Key"].ToString());
    return CryptographicOperations.FixedTimeEquals(given, Encoding.UTF8.GetBytes(adminKey));
}

var admin = app.MapGroup("/admin").AddEndpointFilter(async (ictx, next) =>
    IsAdmin(ictx.HttpContext) ? await next(ictx) : Error(401, "Clé staff invalide."));

admin.MapGet("/players", async (NpgsqlDataSource ds) =>
{
    var list = new List<object>();
    var today = Clock.Today();
    await using var conn = await ds.OpenConnectionAsync();
    await using var cmd = Db.Cmd(conn, null, """
        SELECT p.id, p.character_id, p.slug, p.name, p.approved, p.bonus_tickets, p.last_free_day, p.created_at,
               (SELECT count(*) FROM owned_cards o WHERE o.player_id = p.id)::int,
               (SELECT max(x.at) FROM openings x WHERE x.player_id = p.id)
        FROM players p
        ORDER BY p.approved, lower(p.name)
        """);
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        DateOnly? lastFree = r.IsDBNull(6) ? null : r.GetFieldValue<DateOnly>(6);
        list.Add(new
        {
            id = r.GetInt32(0),
            characterId = r.GetString(1),
            slug = r.GetString(2),
            name = r.GetString(3),
            approved = r.GetBoolean(4),
            bonusTickets = r.GetInt32(5),
            freeAvailable = lastFree is null || lastFree < today,
            createdAt = r.GetDateTime(7),
            unique = r.GetInt32(8),
            lastOpening = r.IsDBNull(9) ? (DateTime?)null : r.GetDateTime(9),
        });
    }
    return Results.Ok(list);
});

admin.MapPost("/players/{id:int}/approve", async (int id, NpgsqlDataSource ds) =>
{
    await using var conn = await ds.OpenConnectionAsync();
    return await Db.ExecAsync(conn, null, "UPDATE players SET approved = true WHERE id = $1", id) == 1
        ? Results.Ok() : Error(404, "Joueur introuvable.");
});

admin.MapPost("/players/{id:int}/tickets", async (int id, TicketsRequest req, NpgsqlDataSource ds) =>
{
    await using var conn = await ds.OpenConnectionAsync();
    return await Db.ExecAsync(conn, null,
            "UPDATE players SET bonus_tickets = GREATEST(0, bonus_tickets + $2) WHERE id = $1", id, req.Amount) == 1
        ? Results.Ok() : Error(404, "Joueur introuvable.");
});

// Distribution à tous les joueurs validés (events)
admin.MapPost("/tickets", async (TicketsRequest req, NpgsqlDataSource ds) =>
{
    await using var conn = await ds.OpenConnectionAsync();
    var n = await Db.ExecAsync(conn, null,
        "UPDATE players SET bonus_tickets = GREATEST(0, bonus_tickets + $1) WHERE approved", req.Amount);
    return Results.Ok(new { players = n });
});

// Code perdu : nouveau code, la collection est conservée. À transmettre au joueur en MP.
admin.MapPost("/players/{id:int}/reset-code", async (int id, NpgsqlDataSource ds) =>
{
    var code = Db.NewCode();
    await using var conn = await ds.OpenConnectionAsync();
    return await Db.ExecAsync(conn, null, "UPDATE players SET code_hash = $2 WHERE id = $1", id, Db.HashCode(code)) == 1
        ? Results.Ok(new { code }) : Error(404, "Joueur introuvable.");
});

// Supprime le joueur et sa collection (code perdu, inscription usurpée…)
admin.MapDelete("/players/{id:int}", async (int id, NpgsqlDataSource ds) =>
{
    await using var conn = await ds.OpenConnectionAsync();
    return await Db.ExecAsync(conn, null, "DELETE FROM players WHERE id = $1", id) == 1
        ? Results.Ok() : Error(404, "Joueur introuvable.");
});

app.Run();

record RegisterRequest(string? CharacterId, string? Slug, string? Name);
record TicketsRequest(int Amount);
