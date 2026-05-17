# 🎨 Atelier design — « voir avant de coder »

But : tu **vois** chaque design dans ton navigateur **avant** qu'il touche le
vrai site. Aucune surprise, aucune casse, qualité validée à l'œil.

> Ce dossier `atelier/` n'est **PAS** servi par le site (le serveur ne sert
> que `public/`). Les maquettes ici sont **privées** : personne ne les voit
> en ligne, elles ne cassent rien en production.

## Comment ça marche (simple)

1. **Tu demandes** un écran ou une amélioration (ex. « refais le Centre de
   pilotage en plus aéré »).
2. **L'agent Designer crée une maquette** ici :
   `atelier/<sujet>-v1.html` (fichier autonome, rendu EXACT du futur écran).
3. **Tu l'ouvres** : double-clic sur le fichier → il s'affiche dans ton
   navigateur. C'est le vrai rendu, pas une image approximative.
4. **Tu dis ce que tu veux changer** (« le titre trop gros », « plus sombre »,
   « j'aime, garde »). L'agent fait une `v2`, `v3`… jusqu'à ce que ce soit
   parfait pour toi.
5. **Quand tu dis « validé »** : on intègre au vrai site, et ça passe par le
   circuit Qualité → Sécurité → mise en ligne (comme d'habitude).

## Règles

- Une maquette = **un fichier autonome** (s'ouvre seul, sans serveur, sans
  internet) : on copie le `_modele.html` qui porte déjà les couleurs/polices
  officielles du site → ce que tu vois = ce que tu auras.
- On **versionne** (`-v1`, `-v2`…) : on garde l'historique des essais, on
  peut revenir en arrière.
- Bandeau « MAQUETTE » visible en haut : impossible de confondre avec le vrai
  site.
- **Rien n'est intégré sans ton « validé »**. L'atelier ne touche jamais la
  prod.

## Pour l'agent Designer (méthode imposée)

- Toujours partir de `atelier/_modele.html` (tokens `:root` identiques au
  site, police Inter, fond premium sombre). Cohérence visuelle garantie.
- Maquette = HTML/CSS **autonome** (pas d'appel API, pas de dépendance
  externe non-CDN ; CDN autorisé seulement si déjà utilisé par le site).
- Nommer `atelier/<sujet>-v<N>.html`. Ne jamais écraser une version :
  créer la suivante.
- Présenter chaque livraison avec : ce qui change, pourquoi (direction
  artistique argumentée), et la question « qu'est-ce que tu ajustes ? ».
- Intégration au vrai site UNIQUEMENT après « validé » fondateur, puis
  circuit qualité (cf. `docs/CONTRAT-technicien.md`).
