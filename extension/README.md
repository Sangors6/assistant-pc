# Extension Chrome — PC Helper

Extension Manifest V3 qui combine deux fonctions dans **une seule extension** :

1. **Pont matériel** — lit le *vrai* matériel du PC via `chrome.system.cpu`,
   `chrome.system.memory`, `chrome.system.display` (charge CPU réelle, modèle,
   nombre de cœurs, RAM utilisée/totale, écran) et le transmet au site
   `assistant-pc.onrender.com`. Le panneau « État du PC » et « Analyser mes
   périphériques » affichent alors des valeurs réelles au lieu des
   approximations du navigateur. Sans l'extension, le site fonctionne toujours
   (repli automatique sur les API navigateur).

2. **Assistant flottant** — un bouton flottant sur **tous les sites** ouvre un
   panneau avec le chat PC Helper complet (même design), connexion incluse. Le
   JWT est stocké dans `chrome.storage.local`. Les appels API sont autorisés
   sans CORS grâce aux `host_permissions` (privilège MV3).

## Installation (mode développeur)

1. Ouvrir `chrome://extensions`
2. Activer **Mode développeur** (en haut à droite)
3. **Charger l'extension non empaquetée** → sélectionner le dossier `extension/`
4. L'icône 🖥️ PC Helper apparaît dans la barre.

## Utilisation

- **Bouton flottant** (coin bas-droit de n'importe quelle page) ou **clic sur
  l'icône de la barre** : ouvre/ferme le panneau.
- Se connecter avec un compte PC Helper → le chat est utilisable partout.
- En visitant `assistant-pc.onrender.com`, le panneau « État du PC » affiche
  automatiquement les vraies mesures matérielles.

## Architecture

| Fichier | Rôle |
|---|---|
| `manifest.json` | MV3 : permissions `system.*`, `storage`, host_permissions |
| `background.js` | Service worker : mesure matérielle réelle + bascule du panneau |
| `content.js` | Toutes pages : lanceur flottant + pont matériel (origine du site) |
| `panel/` | Page d'extension : chat complet (auth + streaming SSE) |
| `icons/` | Icônes 16/48/128 |

## Sécurité

- Le matériel n'est exposé qu'à l'origine du site PC Helper (vérification
  d'origine stricte dans `content.js`) — jamais aux sites tiers.
- Aucun secret dans le code ; le JWT vit dans `chrome.storage.local`.
- Permissions minimales (lecture système uniquement, pas d'historique ni
  d'onglets).

## Notes

- `chrome.system.*` n'expose pas le bus USB ni la température (limite Chrome).
  Pour ces données, un compagnon natif (Native Messaging) serait nécessaire —
  hors périmètre de cette version.
- `API_BASE` est fixé sur la production dans `panel/panel.js` ; le modifier
  pour pointer un serveur local en développement.
