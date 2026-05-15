# Déploiement

## Source de vérité unique

Le serveur Express ne sert **que le dossier `public/`** (`app.use(express.static('public'))`).
Toute page visible en ligne est dans `public/` :

| URL | Fichier |
|-----|---------|
| `/` | `public/index.html` (accueil) |
| `/login.html` | `public/login.html` (connexion / inscription) |
| `/chargement.html` | `public/chargement.html` (écran de transition) |
| `/app.html` | `public/app.html` (application de chat) |

> ⚠️ **Ne jamais recréer un `index.html` à la racine du projet.** Il ne serait
> jamais servi (ni en local ni en ligne) et donnerait la fausse impression que
> les modifications « ne passent pas en ligne ». Toute modif d'interface se fait
> **dans `public/`**.

## Mettre à jour le site en ligne

L'hébergeur (Render) redéploie automatiquement à chaque `push` sur `main` :

```bash
git add -A
git commit -m "ma modification"
git push
```

Render relance alors `npm install` puis `node server.js`. Le déploiement prend
1 à 3 minutes. Les pages HTML sont servies en `Cache-Control: no-cache` : la
nouvelle version est visible **dès le rechargement**, sans vider le cache.

Si une ancienne version persiste : c'est le déploiement Render qui n'est pas
terminé ou a échoué — vérifier l'onglet **Logs / Events** du service Render.

## Variables d'environnement (dashboard Render, jamais dans le dépôt)

- `ANTHROPIC_API_KEY` — clé API Anthropic
- `JWT_SECRET` — ≥ 32 caractères aléatoires
- `DATABASE_URL` — PostgreSQL (`postgres://...?sslmode=require`)

`NODE_ENV=production` et `NODE_VERSION=22` sont fixés par `render.yaml`.

## TLS

En production, c'est le proxy Render qui assure HTTPS : l'app écoute en HTTP
simple sur `PORT`. Le serveur **ne doit pas** gérer son propre HTTPS en ligne
(une redirection 301 vers `:3443` serait mise en cache et casserait l'URL
durablement). Ce comportement est verrouillé par la variable `NODE_ENV` /
détection `RENDER` dans `server.js`. Les certificats `certs/` ne servent qu'au
développement local (HTTPS sur `:3443`).
