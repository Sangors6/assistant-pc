#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
 * Générateur de cockpit — « Vue patron » PC Helper.
 *
 * POURQUOI : les maquettes atelier/cockpit-v*.html sont STATIQUES par
 * conception (règle atelier : fichier autonome, zéro dépendance). Elles ne
 * reflètent donc jamais l'état réel. Ce script lit la source de vérité
 * (CERVEAU/RAPPORT_DIRECTION/*) et REGÉNÈRE un cockpit HTML autonome à jour :
 * les données sont « cuites » dans le fichier au moment de la génération —
 * aucun fetch, aucun CDN, aucune dépendance runtime. Double-clic = à jour.
 *
 * USAGE :   node outils/generer-cockpit.js   (ou : npm run cockpit)
 *           SRC=/chemin/RAPPORT_DIRECTION node outils/generer-cockpit.js
 *
 * Lance-le à chaque session après avoir rafraîchi AGENTS.md / FONDATEUR.md.
 * Zéro impact production (le serveur ne sert que public/ ; ceci écrit dans
 * atelier/, privé). Aucune dépendance npm : Node pur.
 * ───────────────────────────────────────────────────────────────────────── */
'use strict'

const fs = require('fs')
const path = require('path')

// --- Localisation des sources -------------------------------------------
// CERVEAU est le « cerveau externe », sibling du dépôt :
//   .../Desktop/assistant-pc        (ce dépôt, __dirname = repo/outils)
//   .../Desktop/CERVEAU/RAPPORT_DIRECTION
// Surchargeable via la variable d'env SRC (robustesse / portabilité).
const REPO = path.join(__dirname, '..')
const SRC = process.env.SRC ||
  path.join(REPO, '..', 'CERVEAU', 'RAPPORT_DIRECTION')
const SORTIE = path.join(REPO, 'atelier', 'cockpit.html')

// Fichiers source, dans l'ordre d'affichage. `cle` sert d'ancre/onglet.
const SOURCES = [
  { fichier: 'AGENTS.md', titre: 'Vue patron', cle: 'patron' },
  { fichier: 'FONDATEUR.md', titre: 'Note pour toi', cle: 'fondateur' }
]

// --- Échappement HTML (le contenu Markdown est du TEXTE, jamais du code) --
function esc (s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Inline : **gras**, `code`, [texte](url) -> liens neutralisés en texte
// (cockpit hors-ligne : pas de navigation, on garde juste le libellé).
function inline (s) {
  let t = esc(s)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  return t
}

// --- Mini-rendu Markdown -> HTML (couvre AGENTS.md / FONDATEUR.md) --------
// Supporté : # ## ###, --- (hr), > citation, tableaux |..|, listes - et 1.,
// paragraphes. Volontairement minimal, robuste, sans dépendance.
function mdToHtml (md) {
  const lignes = String(md).replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  const fermerListe = { ul: false, ol: false }
  const closeLists = () => {
    if (fermerListe.ul) { out.push('</ul>'); fermerListe.ul = false }
    if (fermerListe.ol) { out.push('</ol>'); fermerListe.ol = false }
  }

  while (i < lignes.length) {
    const l = lignes[i]
    const t = l.trim()

    if (t === '') { closeLists(); i++; continue }

    if (/^---+$/.test(t)) { closeLists(); out.push('<hr>'); i++; continue }

    const h = t.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      closeLists()
      const n = h[1].length
      out.push(`<h${n}>${inline(h[2])}</h${n}>`)
      i++; continue
    }

    // Tableau : ligne |..| suivie d'une ligne séparatrice |---|
    if (t.startsWith('|') && i + 1 < lignes.length &&
        /^\|[\s:|-]+\|?$/.test(lignes[i + 1].trim())) {
      closeLists()
      const cellules = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '')
        .split('|').map((c) => c.trim())
      const entetes = cellules(t)
      out.push('<div class="tbl-wrap"><table><thead><tr>' +
        entetes.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>')
      i += 2
      while (i < lignes.length && lignes[i].trim().startsWith('|')) {
        const cs = cellules(lignes[i])
        out.push('<tr>' + cs.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
        i++
      }
      out.push('</tbody></table></div>')
      continue
    }

    if (t.startsWith('>')) {
      closeLists()
      const buf = []
      while (i < lignes.length && lignes[i].trim().startsWith('>')) {
        buf.push(lignes[i].trim().replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }

    const ol = t.match(/^\d+\.\s+(.*)$/)
    if (ol) {
      if (!fermerListe.ol) { closeLists(); out.push('<ol>'); fermerListe.ol = true }
      out.push(`<li>${inline(ol[1])}</li>`)
      i++; continue
    }

    const ul = t.match(/^[-*]\s+(.*)$/)
    if (ul) {
      if (!fermerListe.ul) { closeLists(); out.push('<ul>'); fermerListe.ul = true }
      out.push(`<li>${inline(ul[1])}</li>`)
      i++; continue
    }

    closeLists()
    out.push(`<p>${inline(t)}</p>`)
    i++
  }
  closeLists()
  return out.join('\n')
}

// --- Assemblage de la page autonome --------------------------------------
function pageHtml (blocs, genLe, manquants) {
  const onglets = blocs.map((b, idx) =>
    `<button class="tab${idx === 0 ? ' on' : ''}" data-cible="sec-${b.cle}">${esc(b.titre)}</button>`
  ).join('')

  const sections = blocs.map((b, idx) =>
    `<section id="sec-${b.cle}" class="doc${idx === 0 ? ' on' : ''}">${b.html}</section>`
  ).join('\n')

  const alerteSrc = manquants.length
    ? `<div class="warn">⚠️ Source(s) introuvable(s) : ${manquants.map(esc).join(', ')}.
       Le cockpit affiche ce qui est disponible. Vérifie <code>${esc(SRC)}</code>.</div>`
    : ''

  // CSS : tokens officiels du site (cf. atelier/_modele.html). Police
  // SYSTÈME (pas de @import Google Fonts) -> 100 % hors-ligne.
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cockpit — Vue patron · PC Helper</title>
<style>
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
  :root{
    --blue:#2563eb;--blue-light:#3b82f6;--blue-dark:#1d4ed8;--cyan:#22d3ee;
    --bg:#060910;--bg-panel:rgba(10,15,28,.92);--bg-card:rgba(13,19,35,.85);
    --border:rgba(59,130,246,.12);--border-hover:rgba(59,130,246,.4);
    --text:#e2e8f0;--text-dim:#475569;--text-mid:#94a3b8;
    --glow:rgba(37,99,235,.4);--success:#22c55e;--danger:#ef4444
  }
  body{font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    background:radial-gradient(1200px 600px at 50% -10%,rgba(37,99,235,.10),transparent 60%),var(--bg);
    color:var(--text);min-height:100vh;line-height:1.6}
  .bar{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:10px;
    padding:9px 16px;font-size:12px;font-weight:700;letter-spacing:.5px;
    color:#0a0f1c;background:linear-gradient(90deg,#fbbf24,#f59e0b)}
  .bar .tag{background:rgba(0,0,0,.18);padding:2px 8px;border-radius:6px}
  .bar .meta{margin-left:auto;font-weight:600;opacity:.85}
  .wrap{max-width:1080px;margin:0 auto;padding:30px 22px 70px}
  .head{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:6px}
  .head h1{font-size:25px;font-weight:800;letter-spacing:-.02em}
  .gen{margin-left:auto;font-size:12px;color:var(--text-mid)}
  .gen b{color:var(--cyan)}
  .tabs{display:flex;gap:8px;margin:20px 0 22px;flex-wrap:wrap}
  .tab{font:inherit;font-size:13px;font-weight:600;color:var(--text-mid);
    background:var(--bg-card);border:1px solid var(--border);padding:9px 16px;
    border-radius:999px;cursor:pointer;transition:.18s}
  .tab:hover{border-color:var(--border-hover);color:var(--text)}
  .tab.on{color:#fff;background:linear-gradient(135deg,var(--blue),var(--blue-dark));
    border-color:transparent;box-shadow:0 8px 22px rgba(37,99,235,.32)}
  .doc{display:none;background:var(--bg-card);border:1px solid var(--border);
    border-radius:18px;padding:26px 28px;backdrop-filter:blur(10px)}
  .doc.on{display:block;animation:in .35s cubic-bezier(.16,1,.3,1)}
  @keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .doc h1{font-size:22px;font-weight:800;margin:2px 0 4px}
  .doc h2{font-size:16px;font-weight:700;color:#cfe0fb;margin:24px 0 10px;
    padding-top:16px;border-top:1px solid var(--border)}
  .doc h2:first-of-type,.doc h1+h2{border-top:0;padding-top:0}
  .doc h3{font-size:14px;font-weight:700;margin:16px 0 8px;color:var(--text-mid)}
  .doc p{font-size:13.5px;color:var(--text);margin:9px 0}
  .doc hr{border:0;border-top:1px solid var(--border);margin:18px 0}
  .doc blockquote{border-left:3px solid var(--blue-light);background:rgba(37,99,235,.06);
    padding:10px 14px;border-radius:0 10px 10px 0;color:var(--text-mid);
    font-size:12.5px;margin:12px 0}
  .doc ul,.doc ol{margin:8px 0 8px 22px}
  .doc li{font-size:13.5px;margin:5px 0}
  .doc code{font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
    font-size:12px;color:var(--cyan);background:rgba(34,211,238,.08);
    padding:1px 6px;border-radius:5px}
  .doc strong{color:#fff;font-weight:700}
  .tbl-wrap{overflow-x:auto;margin:12px 0}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:9px 12px;border:1px solid var(--border);
    vertical-align:top}
  th{background:rgba(37,99,235,.10);color:#cfe0fb;font-weight:700}
  tr:nth-child(even) td{background:rgba(255,255,255,.015)}
  .warn{margin:0 0 18px;padding:11px 15px;border-radius:12px;font-size:13px;
    color:#fde68a;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.30)}
  .foot{margin-top:26px;text-align:center;font-size:11.5px;color:var(--text-dim)}
  @media (prefers-reduced-motion:reduce){.doc.on{animation:none}}
</style>
</head>
<body>
  <div class="bar">
    <span class="tag">COCKPIT</span>
    <span>Vue patron — généré depuis CERVEAU/RAPPORT_DIRECTION (privé, hors site)</span>
    <span class="meta">auto-généré</span>
  </div>
  <div class="wrap">
    <div class="head">
      <h1>👔 Cockpit PC&nbsp;Helper</h1>
      <span class="gen">Généré le <b>${esc(genLe)}</b></span>
    </div>
    ${alerteSrc}
    <div class="tabs">${onglets}</div>
    ${sections}
    <div class="foot">Régénérer : <code>npm run cockpit</code> après mise à jour des sources.</div>
  </div>
  <script>
    /* Onglets — seul JS, purement local (aucune donnée réseau). */
    (function(){
      var tabs=document.querySelectorAll('.tab'),docs=document.querySelectorAll('.doc');
      tabs.forEach(function(t){t.addEventListener('click',function(){
        tabs.forEach(function(x){x.classList.remove('on')});
        docs.forEach(function(x){x.classList.remove('on')});
        t.classList.add('on');
        var c=document.getElementById(t.dataset.cible);
        if(c)c.classList.add('on');
      })});
    })();
  </script>
</body>
</html>
`
}

// --- Exécution ------------------------------------------------------------
function main () {
  const blocs = []
  const manquants = []

  for (const s of SOURCES) {
    const p = path.join(SRC, s.fichier)
    try {
      const md = fs.readFileSync(p, 'utf8')
      blocs.push({ cle: s.cle, titre: s.titre, html: mdToHtml(md) })
    } catch (_) {
      manquants.push(s.fichier)
    }
  }

  if (blocs.length === 0) {
    // Cohérent avec le comportement attendu : pas de source -> cockpit
    // explicite « vide », jamais d'invention.
    blocs.push({
      cle: 'vide', titre: 'Aucune source',
      html: '<h1>Cockpit vide</h1><p>Aucune source lisible dans ' +
        `<code>${esc(SRC)}</code>. Rafraîchis AGENTS.md / FONDATEUR.md puis relance.</p>`
    })
  }

  const genLe = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short'
  })

  fs.mkdirSync(path.dirname(SORTIE), { recursive: true })
  fs.writeFileSync(SORTIE, pageHtml(blocs, genLe, manquants), 'utf8')

  const rel = path.relative(REPO, SORTIE)
  console.log(`✅ Cockpit généré : ${rel}`)
  console.log(`   Sources lues   : ${blocs.filter(b => b.cle !== 'vide').length}/${SOURCES.length}` +
    (manquants.length ? `  (manquant : ${manquants.join(', ')})` : ''))
  console.log(`   Généré le      : ${genLe}`)
}

main()
