# Contrat du panneau « Contacter un technicien »

> But : figer ce qui NE DOIT PAS casser quand on fait évoluer
> `public/technicien.html`. Tout edit futur s'ancre sur ce contrat.
> Le filet automatique vit dans `test/smoke.test.mjs`
> (tests « CONTRAT technicien … ») : il échoue AVANT la prod si un hook
> disparaît, si le JS inline ne compile plus, ou si un asset média perd
> son cache-buster. Baseline stable : tag git `stable-2026-05-17`.

## Invariants (ne jamais supprimer sans décision explicite + MAJ des tests)

### Anti-flash (ouverture sans clignotement de l'accueil)
- Classe `tech-restore` posée sur `<html>` avant le 1er paint si `sessionIdTech`.
- `#chat-skeleton` (squelette de chargement) + `window.pageContenuPret`
  (le voile attend que la conversation soit prête).

### Transition de page + son
- `#nav-fx` (voile), `window.navTo = function` (liens dashboard ⇄ technicien).
- `sessionStorage 'navfx'` porte le sens de navigation.
- Son swoosh : **uniquement à l'aller** (`d === 'forward'`), une seule fois,
  via Web Audio (`decodeAudioData`) + fallback `<audio>`. **Aucun** audio dans
  `app.html` (vérifié par test). Muet si `prefers-reduced-motion`.
- Assets média référencés avec cache-buster `?v=N` (swoosh + notify) —
  règle absolue : tout asset remplacé sous le même nom DOIT bumper `?v=N`.

### Présence / scénario
- `rendrePresence`, `tirerScenario`, `DELAIS` : source unique des délais ET
  du « Temps de réponse estimé » (pas de logique dupliquée).

### Historique
- `chargerHistoriqueTech`, route `/technicien/sessions`, `#hist-panel`.
- Restauration auto de la dernière conversation ; canal `technicien`
  jamais mélangé au `/chat`.

### Notifications
- `#notif-bubble`, `proposerNotif` (pré-invite douce, snooze 24 h),
  `notifierReponse` (son + notif si onglet pas au premier plan).

### ETA
- `Temps de réponse estimé` affiché (accueil + à l'envoi), via `etaScenario`.

### Cœur chat (NE JAMAIS RÉGRESSER)
- `ajouterMsg`, `envoyer`, `sessionIdTech`, route `/technicien`.
- L'assistant principal (`/chat`) et `app.html` ne doivent JAMAIS être
  impactés par un changement du panneau technicien.

## Règles de travail (éviter les casses)
1. Travailler sur la branche `feat/panel`, pas `main` direct (session
   parallèle « extension » pousse aussi sur `main`).
2. Ne stager QUE son périmètre (jamais le WIP d'une autre session —
   « passager clandestin »).
3. Avant tout swap d'asset : `md5sum` source vs déployé ; si identiques =
   problème de cache → cache-buster, pas re-copie.
4. Circuit avant prod : Informatique → Qualité (→ Sécurité si surface
   sensible) → Déploiement. `npm test` doit rester vert.
5. Vérif post-déploiement : `/health`, `/technicien.html`, asset `?v=`,
   marqueurs du contrat présents dans la page servie.
