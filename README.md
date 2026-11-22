# Rolea Booster

Mini-jeu d'ouverture de boosters pour un forum Rolea (offre gratuite).
Rolea n'affiche que l'interface. Les tickets, les tirages et les collections sont gérés par une petite API ASP.NET hébergée sur Vercel, avec une base Postgres Neon.

```
booster-api/      API .NET 10 (Dockerfile pour Vercel)
  cards.json      ← tes cartes et les taux de rareté
rolea/booster.js  ← script à coller dans Rolea
```

## 1. Déployer l'API sur Vercel

1. Mets le projet sur GitHub.
2. Vercel › **Add New › Project** › importe le dépôt, puis règle **Root Directory** sur `booster-api`. Vercel trouve le `Dockerfile` et choisit le preset **Container**.
3. Onglet **Storage** du projet › **Neon** › crée la base et connecte-la au projet. La variable `DATABASE_URL` est ajoutée automatiquement.
4. **Settings › Environment Variables** :

   | Variable | Valeur |
   |---|---|
   | `ADMIN_KEY` | un mot de passe long (12 caractères minimum) pour le panneau staff |
   | `ALLOWED_ORIGIN` | `https://pouet-pouet.rolea.es` |
   | `AUTO_APPROVE` | *(optionnel)* `true` pour valider les inscriptions sans le staff |
   | `GAME_TIMEZONE` | *(optionnel)* `Europe/Paris` par défaut : heure du reset quotidien |

5. Redéploie, puis ouvre `https://<ton-projet>.vercel.app/ping` : la page doit afficher `pong`. Les tables sont créées au premier démarrage.

## 2. Brancher Rolea

1. Crée une page **Boosters** contenant : `<div id="booster-zone"></div>`
2. Crée une page **staff** contenant : `<div id="booster-admin"></div>`. Elle est protégée par `ADMIN_KEY`, même si quelqu'un la trouve.
3. **Administration › Site › Code** : ajoute `rolea/booster.js`, chargé en **fin de page**, et remplace `API` en haut du fichier par l'adresse Vercel.

### Personnaliser l'apparence

En haut de `booster.js`, dans `CONFIG` :

| Réglage | Rôle |
|---|---|
| `PACK_NAME` | texte écrit sur le booster (`"Booster"` par défaut) |
| `PACK_COLOR` | couleur du paquet |
| `GILT` | couleur des dorures (cadres, filets, liens) |
| `ACCENT` | couleur du bouton principal |
| `SHOW_CARD_TEXT` | `false` si tes illustrations contiennent déjà le nom de la carte |
| `LOAD_FONTS` | `false` pour garder les polices du forum au lieu de Cormorant Garamond + Inter |

## 3. Fonctionnement

- **Inscription** : le joueur clique sur « Inscrire mon personnage » et reçoit un code (gardé dans son navigateur). Le staff valide ensuite l'inscription depuis la page staff.
- **Boosters** : 1 gratuit par jour et par personnage (remis à zéro à minuit), plus les tickets bonus donnés par le staff (à un joueur, ou à tous pour un event).
- **Ouverture** : un clic sur le booster le déchire et laisse place à une pile de cartes face cachée. Chaque clic sur la pile tire la carte suivante. La collection n'est mise à jour qu'à la fin du tirage.
- **Tirage** : 5 cartes, dont la dernière est au moins Peu commune. Le tirage est fait côté serveur avec un aléa cryptographique, donc impossible à truquer depuis la console.
- **Code perdu** : page staff › « Nouveau code ». La collection est conservée. Envoie le nouveau code au joueur en MP.
- **Profils** : la collection s'ajoute en bas de la fiche des personnages inscrits.

## 4. Modifier les cartes

Édite `booster-api/cards.json`, pousse sur GitHub, et Vercel redéploie tout seul.

- Ne change **jamais** l'`id` d'une carte déjà en jeu : c'est lui qui est stocké dans les collections.
- `image` : l'URL **https** d'une illustration au format **350×500 px** (ratio 7:10). Elle remplit toute la carte. Le nom et la rareté s'affichent par-dessus, en bas ; mets `SHOW_CARD_TEXT: false` dans `booster.js` si tes illustrations les contiennent déjà.
- `finish` d'une rareté : l'effet de ses cartes, parmi `normal`, `argent`, `or` ou `foil` (holographique). Par défaut : Commune normal, Peu commune argent, Rare or, Légendaire foil. Une carte peut avoir son propre `finish`, qui remplace celui de sa rareté (une commune en foil, par exemple).
- Un clic sur une carte de la collection l'affiche en grand, à sa taille réelle de 350×500. Sur ordinateur, le reflet suit la souris.
- `weight` des raretés : leur probabilité relative. Celui d'une carte (1 par défaut) la rend plus ou moins fréquente dans sa rareté.

## Si la collection n'apparaît pas sur les profils

La documentation de Rolea ne donne ni le nom exact de la route des fiches personnage, ni la structure de leur page. Pour les trouver :

1. Mets `DEBUG: true` en haut de `booster.js` et ouvre une fiche personnage.
2. Dans la console (F12), copie la ligne `[booster] R.page = …`.
3. Ajuste `profileSlug()` d'après cette ligne, et `PROFILE_TARGET` (sélecteur CSS du bloc où insérer la collection).
