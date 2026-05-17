# SPEC — « Centre de pilotage » (panneau Directeur)

Branche : `feat/panel`. Baseline stable : tag `stable-2026-05-17`.
Décisions fondateur (verrouillées) :
1. **Concept** : fenêtre type application. Directeur en haut qui supervise,
   agents animés « au travail » en dessous, chat avec le Directeur sur le
   côté, onglet « Détails techniques » masqué par défaut.
2. **Interlocuteur** : un **Directeur dédié** (nouveau fil, persona chef
   d'orchestre) — distinct de l'assistant principal et du technicien.
3. **Simulation** : **stylisée et vivante** (décor crédible animé, AUCUN
   branchement sur un vrai état serveur — zéro fragilité).
4. **Ouverture** : bouton « Centre de pilotage » sur le tableau de bord
   (`app.html`) → ouvre `pilotage.html` via la transition voile existante
   (`navTo('/pilotage.html','forward')`).

## Périmètre fichiers
- NOUVEAU `public/pilotage.html` (calqué sur l'architecture éprouvée de
  `technicien.html` : auth client, voile `#nav-fx`+swoosh forward, anti-flash,
  présence/point en ligne, historique, bulle notif).
- `server.js` : NOUVELLE route `POST /directeur` (clone EXACT des middlewares
  /technicien : `limiteurChat, authentifier, limiteurChatCompte`, streaming
  SSE identique), `SYSTEM_PROMPT_DIRECTEUR`, INSERT `canal='directeur'`.
  NOUVELLE `GET /directeur/sessions` (clone /technicien/sessions, filtre
  `canal='directeur'`). Réutilise `/historique/:id` (canal-agnostique) et
  `/technicien/statut` n'est PAS réutilisé → ajouter `/directeur/statut`
  (clone). `database.js` : `canal` existe déjà (rien à migrer).
- `app.html` : 1 bouton « Centre de pilotage » (nav-item) → `navTo(...)`.
  AUCUN autre changement, AUCUN audio.
- `docs/CONTRAT-technicien.md` + `test/smoke.test.mjs` : étendre le contrat
  et le filet anti-régression au nouveau panneau.
- INTERDIT : toucher `extension/*` (session parallèle), `.env`, `/chat`,
  l'assistant principal, la base (schéma).

## Persona Directeur (SYSTEM_PROMPT_DIRECTEUR)
Chef d'orchestre de PC Helper qui supervise 7 agents (Idées, Design,
Informatique, Qualité, Sécurité, Hacker éthique, Support). Parle à un
**débutant total** : phrases simples, zéro jargon dans la réponse
principale ; si une notion technique est nécessaire, il la met en fin de
message sous un bloc court préfixé `【Détails techniques】` (le front le
route vers le volet caché). Rassurant, clair, oriente l'action. Identité :
PC Helper, jamais Claude/OpenAI/etc. Hors-sujet → recadre en 1 phrase.

## UI (clarté débutant = priorité absolue)
- Barre d'appli : `🏢 Centre de pilotage` · `👔 Directeur ●en ligne`.
- Scène centrale : carte Directeur (supervise) + 7 stations d'agents avec
  nom clair en français + 1 ligne « ce qu'il fait » + statut animé qui
  change doucement (« analyse… », « en pause », « livré ✓ ») — purement
  décoratif (timers aléatoires bornés, `prefers-reduced-motion` = statique).
- Chat Directeur : pipeline SSE identique à technicien (streaming, copie,
  markdown sanitizé). Comportement humain léger OK mais SOBRE.
- Volet « ▸ Détails techniques » : fermé par défaut ; reçoit (a) les blocs
  `【Détails techniques】` extraits des réponses, (b) l'explication du
  fonctionnement de l'entreprise/agents en langage avancé. JAMAIS de jargon
  hors de ce volet.
- Réutilise voile+swoosh (`forward` only, `?v=` cache-bust), anti-flash
  (`pilote-restore` équivalent), point présence, historique Directeur.

## Definition of Done
- `node -c server.js` OK ; JS inline des pages valide ; `npm test` vert,
  contrat étendu (hooks pilotage + `/directeur` 401 sans token).
- Circuit : Informatique → Qualité (GO) → Sécurité (route auth/IA = surface
  sensible, revue obligatoire, cf. leçon 12) → Directeur déploie.
- Zéro régression : `/chat`, `/technicien`, app.html intacts ; `extension/*`
  non touché ; staging périmètre strict (pas de passager clandestin).
