using System.Security.Cryptography;
using System.Text.Json;

namespace BoosterApi;

public sealed record Rarity(string Id, string Label, int Weight, string? Color = null, string Finish = "normal");

/// <summary>Finish (optionnel) : remplace la finition de la rareté pour cette carte (ex. une commune en foil).</summary>
public sealed record Card(string Id, string Name, string Rarity, string? Image = null, string? Description = null, int Weight = 1, string? Finish = null);

public sealed class CatalogFile
{
    public int PackSize { get; set; } = 5;
    public string? GuaranteedMinRarity { get; set; }
    public List<Rarity> Rarities { get; set; } = new();
    public List<Card> Cards { get; set; } = new();
}

/// <summary>Catalogue des cartes (cards.json) et tirage des boosters.</summary>
public sealed class Catalog
{
    public int PackSize { get; }
    public IReadOnlyList<Rarity> Rarities { get; }
    public IReadOnlyList<Card> Cards { get; }

    private readonly Dictionary<string, int> _rank;              // rareté -> rang (0 = la plus commune)
    private readonly Dictionary<string, List<Card>> _byRarity;
    private readonly int _guaranteedRank;

    public static readonly string[] Finishes = ["normal", "argent", "or", "foil"];

    private static void CheckFinish(string? finish, string where)
    {
        if (finish is not null && !Finishes.Contains(finish))
            throw new InvalidDataException($"{where} : finish '{finish}' inconnue (valeurs : {string.Join(", ", Finishes)}).");
    }

    private Catalog(CatalogFile f)
    {
        if (f.PackSize is < 1 or > 20) throw new InvalidDataException("packSize doit être entre 1 et 20.");
        if (f.Rarities.Count == 0) throw new InvalidDataException("Aucune rareté définie.");

        _rank = new(StringComparer.Ordinal);
        for (var i = 0; i < f.Rarities.Count; i++)
        {
            var r = f.Rarities[i];
            if (string.IsNullOrWhiteSpace(r.Id)) throw new InvalidDataException($"Rareté n°{i + 1} sans id.");
            if (r.Weight <= 0) throw new InvalidDataException($"Rareté '{r.Id}' : weight doit être > 0.");
            CheckFinish(r.Finish, $"Rareté '{r.Id}'");
            if (!_rank.TryAdd(r.Id, i)) throw new InvalidDataException($"Rareté '{r.Id}' en double.");
        }

        _byRarity = f.Rarities.ToDictionary(r => r.Id, _ => new List<Card>(), StringComparer.Ordinal);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in f.Cards)
        {
            if (string.IsNullOrWhiteSpace(c.Id)) throw new InvalidDataException($"Carte '{c.Name}' sans id.");
            if (!ids.Add(c.Id)) throw new InvalidDataException($"Carte '{c.Id}' en double.");
            if (c.Weight <= 0) throw new InvalidDataException($"Carte '{c.Id}' : weight doit être > 0.");
            CheckFinish(c.Finish, $"Carte '{c.Id}'");
            if (!_byRarity.TryGetValue(c.Rarity, out var list))
                throw new InvalidDataException($"Carte '{c.Id}' : rareté inconnue '{c.Rarity}'.");
            list.Add(c);
        }
        foreach (var (rarity, list) in _byRarity)
            if (list.Count == 0) throw new InvalidDataException($"Aucune carte pour la rareté '{rarity}'.");

        _guaranteedRank = 0;
        if (!string.IsNullOrWhiteSpace(f.GuaranteedMinRarity) && !_rank.TryGetValue(f.GuaranteedMinRarity, out _guaranteedRank))
            throw new InvalidDataException($"guaranteedMinRarity inconnue '{f.GuaranteedMinRarity}'.");

        PackSize = f.PackSize;
        Rarities = f.Rarities;
        Cards = f.Cards;
    }

    public static Catalog Load(string path)
    {
        var options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        };
        var file = JsonSerializer.Deserialize<CatalogFile>(File.ReadAllText(path), options)
                   ?? throw new InvalidDataException("cards.json vide.");
        return new Catalog(file);
    }

    public int RankOf(string rarityId) => _rank[rarityId];

    /// <summary>Tire un booster. La dernière carte respecte la rareté minimale garantie.
    /// Les cartes sont rendues de la moins rare à la plus rare (suspense !).</summary>
    public List<Card> DrawPack()
    {
        var pack = new List<Card>(PackSize);
        for (var i = 0; i < PackSize; i++)
        {
            var minRank = i == PackSize - 1 ? _guaranteedRank : 0;
            var allowed = Rarities.Where(r => _rank[r.Id] >= minRank).ToList();
            var rarity = Pick(allowed, r => r.Weight);
            pack.Add(Pick(_byRarity[rarity.Id], c => c.Weight));
        }
        return pack.OrderBy(c => _rank[c.Rarity]).ToList();
    }

    private static T Pick<T>(IReadOnlyList<T> items, Func<T, int> weight)
    {
        var total = items.Sum(weight);
        var roll = RandomNumberGenerator.GetInt32(total); // aléa cryptographique, non prédictible
        foreach (var item in items)
        {
            roll -= weight(item);
            if (roll < 0) return item;
        }
        return items[^1];
    }

    /// <summary>Ce que les joueurs peuvent voir (taux inclus, par transparence).</summary>
    public object PublicView() => new
    {
        packSize = PackSize,
        guaranteedMinRarity = Rarities[_guaranteedRank].Id,
        rarities = Rarities.Select(r => new
        {
            r.Id, r.Label, r.Color, r.Finish,
            percent = Math.Round(100.0 * r.Weight / Rarities.Sum(x => x.Weight), 2),
        }),
        cards = Cards.Select(c => new { c.Id, c.Name, c.Rarity, c.Image, c.Description, c.Finish }),
    };
}
