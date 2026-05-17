/* PC Helper — content script (toutes les pages).
 *  - Lanceur flottant très visible + morph liquide vers le panneau.
 *  - Panneau réglable : déplaçable (drag fiable en coords écran) et 3 tailles,
 *    géométrie persistée dans chrome.storage.local.
 *  - Sur l'origine du site PC Helper uniquement : pont matériel.
 */
(function () {
  if (window.top !== window || window.__pcHelperInjecte) return
  window.__pcHelperInjecte = true

  const ORIGINES_SITE = [
    'https://assistant-pc.onrender.com',
    'http://localhost:3000',
    'http://localhost:3010',
    'http://localhost:3011'
  ]

  /* ---------------- Pont matériel (origine du site seulement) ----------- */
  if (ORIGINES_SITE.includes(location.origin)) {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const d = event.data
      if (!d || d.__pchelper !== 'hwReq') return
      chrome.runtime.sendMessage({ type: 'PCHELPER_HW' }, (rep) => {
        // Lecture explicite : un canal SW endormi/rechargé renvoie une
        // erreur via lastError ; sans la lire, l'échec serait muet.
        const err = chrome.runtime.lastError
        window.postMessage({
          __pchelper: 'hwRes',
          id: d.id,
          ok: !err && !!(rep && rep.ok),
          data: !err && rep && rep.data ? rep.data : null
        }, location.origin)
      })
    })
    window.postMessage({ __pchelper: 'present' }, location.origin)

    /* Diagnostic proactif : sonde périodique NON intrusive. Si une
     * ressource devient critique, on le SIGNALE à la page — c'est elle
     * qui décide d'en faire quoi (jamais d'action automatique). Tout est
     * isolé et silencieux en cas d'échec : zéro impact sur le pont hwReq. */
    let pchDerniereAlerte = 0
    function pchSonderProactif() {
      if (document.hidden) return
      try {
        chrome.runtime.sendMessage({ type: 'PCHELPER_HW' }, (rep) => {
          if (chrome.runtime.lastError || !rep || !rep.ok || !rep.data) return
          const hw = rep.data
          const now = Date.now()
          if (now - pchDerniereAlerte < 8 * 60 * 1000) return // ≤ 1 / 8 min
          let pb = null
          if (hw.cpu && hw.cpu.charge >= 92) {
            pb = { type: 'cpu', valeur: hw.cpu.charge,
              texte: 'CPU à ' + hw.cpu.charge + '% — ton PC est très sollicité.' }
          } else if (hw.memoire && hw.memoire.pct >= 90) {
            pb = { type: 'ram', valeur: hw.memoire.pct,
              texte: 'RAM utilisée à ' + hw.memoire.pct + '% — risque de ralentissements.' }
          }
          if (pb) {
            pchDerniereAlerte = now
            window.postMessage({ __pchelper: 'proactif', pb }, location.origin)
          }
        })
      } catch {}
    }
    setTimeout(pchSonderProactif, 12000)
    setInterval(pchSonderProactif, 60000)
  }

  /* ---------------- Tailles réglables ---------------------------------- */
  const TAILLES = {
    compact:  { w: 360, h: 540 },
    standard: { w: 404, h: 628 },
    large:    { w: 468, h: 734 }
  }
  const MARGE = 20
  let geo = { preset: 'standard', left: null, top: null }

  function dims() {
    const t = TAILLES[geo.preset] || TAILLES.standard
    return {
      w: Math.min(t.w, window.innerWidth - MARGE * 2),
      h: Math.min(t.h, window.innerHeight - MARGE * 2)
    }
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

  function cible() {
    const { w, h } = dims()
    let left = geo.left, top = geo.top
    if (left == null || top == null) {
      left = window.innerWidth - w - MARGE
      top = window.innerHeight - h - MARGE
    }
    left = clamp(left, MARGE, Math.max(MARGE, window.innerWidth - w - MARGE))
    top = clamp(top, MARGE, Math.max(MARGE, window.innerHeight - h - MARGE))
    return { left, top, w, h }
  }

  const persister = () => { try { chrome.storage.local.set({ pchGeo: geo }) } catch {} }

  /* ---------------- DOM (shadow, isolé du site hôte) ------------------- */
  const hote = document.createElement('div')
  hote.id = 'pchelper-host'
  hote.style.cssText = 'all:initial;position:fixed;z-index:2147483647;'
  const shadow = hote.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(hote)

  shadow.innerHTML = `
    <style>
      :host { all: initial; }

      /* ====================================================================
         Lanceur « Beacon v3 » (DA itération 3, validée fondateur)
         Palette PROFONDE : obsidienne bleutée (bleu-nuit / indigo) +
         veine d'énergie électrique qui dérive. Le voyant naît du
         CONTRASTE arête lumineuse vs corps sombre (plus d'aplat clair).
         Libellé + point d'état vert visibles AU REPOS. Halo bleu vif +
         anneau sonar cyan-bleu. Gabarit repos INCHANGÉ : H 60 / L ≈ 188
         (LAN={w:188,h:60} côté JS, le morph part de cette boîte).
         ==================================================================== */
      @keyframes pchA-arrive{
        0%{opacity:0;transform:translateY(16px) scale(.82)}
        60%{opacity:1}
        100%{opacity:1;transform:translateY(0) scale(1)}
      }
      /* Sonar : anneau électrique qui s'écarte. Cyan-bleu vif = le « signal
         voyant » sur la base sombre. Espacé (3.4s) — signal, pas blink. */
      @keyframes pchA-sonar{
        0%{transform:translate(-50%,-50%) scale(.6);opacity:.7}
        70%{opacity:0}
        100%{transform:translate(-50%,-50%) scale(1.5);opacity:0}
      }
      /* Dérive lente de l'arête lumineuse interne : énergie qui circule. */
      @keyframes pchA-flow{
        0%{background-position:0% 50%}
        100%{background-position:200% 50%}
      }
      /* --- Morph liquide du PANNEAU (DA v3) : tension de surface ---
         Phases sur .58s (alignées sur le morph géométrique JS) :
           0%   pilule pleine (30px) — état lanceur EXACT
           18%  la masse « gonfle » d'un côté
           42%  étirement diagonal max (la goutte coule vers le panneau)
           70%  rebond de tension (sur-arrondi opposé, plus doux)
           100% géométrie panneau (22px) — net, stable */
      @keyframes pch-liquid {
        0%   { border-radius: 30px; }
        18%  { border-radius: 48% 30% 30% 52% / 56% 38% 40% 58%; }
        42%  { border-radius: 58% 42% 38% 56% / 60% 50% 42% 56%; }
        70%  { border-radius: 30% 26% 30% 26% / 30% 30% 26% 28%; }
        100% { border-radius: 22px; }
      }
      /* Gouttes « goo » : deux bulles filtrées (métaballe) qui se détachent
         de la masse et se résorbent. Visibles seulement morphing/closing. */
      @keyframes pch-goo1{
        0%  {transform:translate(0,0) scale(.5);opacity:0}
        22% {opacity:1}
        55% {transform:translate(40px,-46px) scale(1.5);opacity:1}
        100%{transform:translate(72px,-90px) scale(2.4);opacity:0}
      }
      @keyframes pch-goo2{
        0%  {transform:translate(0,0) scale(.4);opacity:0}
        30% {opacity:1}
        60% {transform:translate(-32px,-30px) scale(1.4);opacity:1}
        100%{transform:translate(-58px,-66px) scale(2.1);opacity:0}
      }

      .pch-launch{
        position:fixed; right:22px; bottom:22px;
        height:60px; padding:0 24px 0 18px;
        border:none; cursor:pointer; isolation:isolate;
        display:flex; align-items:center; gap:0;
        color:#eaf1ff; font:700 15px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        letter-spacing:.005em; white-space:nowrap;
        border-radius:30px;
        /* PALETTE PROFONDE — obsidienne bleutée + veine électrique.
           Couche 1 (animée) : veine d'énergie cyan→bleu qui dérive (220%).
           Couche 2 (fixe)    : corps obsidienne dense bleu-nuit→indigo. */
        background:
          linear-gradient(100deg,
            rgba(56,150,255,0) 0%, rgba(56,150,255,0) 30%,
            rgba(74,170,255,.55) 44%, rgba(120,150,255,.62) 52%,
            rgba(74,140,255,.50) 60%, rgba(56,150,255,0) 74%,
            rgba(56,150,255,0) 100%),
          linear-gradient(150deg,#0a132e 0%,#0c1a44 38%,#101f55 60%,#0a1336 100%);
        background-size:220% 100%,100% 100%;
        box-shadow:
          0 1px 0 rgba(150,190,255,.40) inset,            /* arête haute = lumière */
          0 0 0 1px rgba(96,150,255,.55) inset,            /* liseré électrique net */
          0 0 22px -2px rgba(60,130,255,.55) inset,        /* lueur interne profonde */
          0 14px 34px -10px rgba(20,55,170,.78),           /* glow porté dense */
          0 26px 64px -18px rgba(28,70,210,.55),           /* halo large */
          0 4px 14px -4px rgba(0,0,0,.50);                 /* assise (lift fond clair) */
        transition:
          transform .32s cubic-bezier(.34,1.5,.5,1),
          box-shadow .32s ease, opacity .26s ease, padding .3s ease;
        animation:
          pchA-arrive .6s cubic-bezier(.34,1.45,.5,1) both,
          pchA-flow 8s linear infinite;
      }
      /* Anneau sonar — cyan-bleu vif : LE signal qui « pulse » sur l'obsidienne. */
      .pch-launch::after{
        content:""; position:absolute; left:50%; top:50%; z-index:-1;
        width:128%; height:172%; border-radius:999px;
        border:2px solid rgba(96,170,255,.72);
        transform:translate(-50%,-50%) scale(.6);
        animation:pchA-sonar 3.4s cubic-bezier(.22,.61,.36,1) infinite;
      }
      /* Halo statique projeté sous la pilule — bleu électrique dense. */
      .pch-launch::before{
        content:""; position:absolute; left:50%; bottom:-15px; z-index:-2;
        width:86%; height:32px; transform:translateX(-50%);
        background:radial-gradient(50% 100% at 50% 0%,rgba(46,110,255,.62),transparent 72%);
        filter:blur(12px); opacity:.92; transition:opacity .3s ease;
      }
      .pch-launch .ic{
        position:relative; z-index:1; display:flex; width:26px; height:26px; flex:none;
        color:#eaf1ff; filter:drop-shadow(0 1px 4px rgba(0,12,50,.7));
        transition:transform .32s cubic-bezier(.34,1.56,.64,1);
      }
      .pch-launch .ic svg{width:26px;height:26px;display:block}
      /* Point d'état vert — VISIBLE AU REPOS (signal système actif). */
      .pch-launch .dot{
        position:relative; z-index:1; flex:none;
        width:8px; height:8px; border-radius:50%; margin-left:11px;
        background:#34e0a0;
        box-shadow:0 0 0 3px rgba(255,255,255,.14),0 0 12px rgba(52,224,160,1);
      }
      /* Libellé — VISIBLE AU REPOS (identité affichée). Texte clair sur sombre. */
      .pch-launch .lbl{
        position:relative; z-index:1; margin-left:11px;
        color:#f0f5ff; text-shadow:0 1px 3px rgba(0,10,40,.6);
      }
      .pch-launch:hover,
      .pch-launch:focus-visible{
        transform:translateY(-3px) scale(1.03);
        box-shadow:
          0 1px 0 rgba(170,205,255,.5) inset,
          0 0 0 1px rgba(130,180,255,.75) inset,
          0 0 26px -2px rgba(70,145,255,.7) inset,
          0 20px 48px -10px rgba(24,65,200,.9),
          0 36px 86px -20px rgba(30,75,220,.62),
          0 6px 18px -4px rgba(0,0,0,.52);
      }
      .pch-launch:hover::before,
      .pch-launch:focus-visible::before{opacity:1}
      .pch-launch:hover .ic,
      .pch-launch:focus-visible .ic{transform:scale(1.08) rotate(-2deg)}
      .pch-launch:focus-visible{outline:3px solid rgba(150,195,255,.95);outline-offset:3px}
      .pch-launch:active{transform:translateY(-1px) scale(.985)}

      /* — Hook JS INCHANGÉ : disparition quand le panneau s'ouvre.
           La pilule s'efface vite : c'est la matière liquide du #wrap
           qui prend visuellement le relais (recouvrement orchestré). — */
      .pch-launch.gone{
        transform:scale(.86);opacity:0;pointer-events:none;
        transition:transform .2s cubic-bezier(.5,0,.2,1),opacity .16s ease;
      }

      /* — Accessibilité mouvement : au repos AUCUN mouvement perpétuel.
         Sonar/flow coupés ; halo + anneau + palette/contraste statiques
         garantissent la présence par forme/couleur (pas par animation). — */
      @media (prefers-reduced-motion:reduce){
        .pch-launch{animation:none;background-position:0% 50%,0% 50%}
        .pch-launch::after{animation:none;opacity:.45;transform:translate(-50%,-50%) scale(1)}
        .pch-launch,.pch-launch .ic{transition:opacity .15s ease}
        .pch-launch:hover,.pch-launch:focus-visible{transform:none}
        .pch-launch.gone{transition:opacity .12s ease}
      }

      /* ====================================================================
         PANNEAU + TRANSFORMATION LIQUIDE bouton→panneau (DA v3)
         La matière du #wrap part EXACTEMENT du gabarit pilule (188×60,
         rayon 30) et « coule » vers cible(). .pch-skin porte le clip+radius
         et enveloppe l'iframe ; .pch-goolayer porte les 2 gouttes filtrées.
         ==================================================================== */
      .pch-wrap {
        position: fixed; left: 0; top: 0; width: 188px; height: 60px;
        border-radius: 30px; overflow: visible; display: none;
        background:
          radial-gradient(120% 140% at 50% 0%,#13234f 0%,#0a1330 55%,#06090f 100%);
        opacity: 0;
        box-shadow:
          0 0 0 1px rgba(96,150,255,.30) inset,
          0 30px 90px rgba(8,18,55,.65), 0 2px 12px rgba(0,0,0,.5);
        will-change: left, top, width, height, border-radius, opacity, transform;
      }
      /* La surface visible/clip est portée par .pch-skin (l'iframe vit
         dedans). overflow visible sur .pch-wrap pour que les gouttes
         (.pch-goolayer) débordent du gabarit. */
      .pch-skin {
        position: absolute; inset: 0; border-radius: inherit;
        overflow: hidden; background: inherit;
      }
      .pch-wrap .pch-frame {
        position: absolute; inset: 0; width: 100%; height: 100%;
        border: none; display: block;
        opacity: 0; transition: opacity .3s ease .14s;
      }
      .pch-wrap.revealed .pch-frame { opacity: 1; }
      .pch-wrap.show { display: block; }
      .pch-wrap.open {
        opacity: 1;
        transition:
          left .54s cubic-bezier(.62,.04,.2,1),
          top .54s cubic-bezier(.62,.04,.2,1),
          width .58s cubic-bezier(.34,1.32,.5,1),
          height .58s cubic-bezier(.34,1.32,.5,1),
          opacity .26s ease;
      }
      /* Morph liquide UNIQUEMENT à l'ouverture, classe transitoire :
         ainsi rien ne peut le rejouer (ex. fin de drag). Le radius est
         animé sur .pch-wrap ET .pch-skin (clip suit la tension de surface). */
      .pch-wrap.morphing { animation: pch-liquid .58s cubic-bezier(.5,0,.2,1) forwards; }
      .pch-wrap.morphing .pch-skin { animation: pch-liquid .58s cubic-bezier(.5,0,.2,1) forwards; }

      /* Gouttes goo : passées dans le filtre SVG #pch-goo (fusion
         métaballe). Couleur = corps. Zéro coût au repos (opacity 0). */
      .pch-goolayer {
        position: absolute; inset: -40px; pointer-events: none;
        filter: url(#pch-goo); opacity: 0; z-index: -1;
      }
      .pch-wrap.morphing .pch-goolayer,
      .pch-wrap.closing  .pch-goolayer { opacity: 1; }
      .pch-goolayer i {
        position: absolute; display: block; border-radius: 50%;
        background: radial-gradient(circle at 38% 32%,#1b2f63,#0a1330 70%);
      }
      .pch-goolayer i.b1 { width: 54px; height: 54px; left: 24%; top: 50%; }
      .pch-goolayer i.b2 { width: 38px; height: 38px; left: 62%; top: 46%; }
      .pch-wrap.morphing .pch-goolayer i.b1 { animation: pch-goo1 .58s cubic-bezier(.5,0,.2,1) forwards; }
      .pch-wrap.morphing .pch-goolayer i.b2 { animation: pch-goo2 .58s cubic-bezier(.5,0,.2,1) forwards; }
      /* Fermeture = effet inverse (la masse se rétracte en gouttes vers la pilule) */
      .pch-wrap.closing  .pch-goolayer i.b1 { animation: pch-goo1 .42s cubic-bezier(.5,0,.2,1) reverse forwards; }
      .pch-wrap.closing  .pch-goolayer i.b2 { animation: pch-goo2 .42s cubic-bezier(.5,0,.2,1) reverse forwards; }

      /* Atterrissage subtil quand on relâche après un déplacement :
         une micro-respiration élastique, voulue et discrète. */
      @keyframes pch-settle {
        0%   { transform: scale(1); }
        38%  { transform: scale(1.015); }
        100% { transform: scale(1); }
      }
      .pch-wrap.settle { animation: pch-settle .36s cubic-bezier(.34,1.56,.64,1); }
      /* Fermeture : la matière REFLUE vers la pilule (rayon 30, boîte
         188×60). border-radius repasse en pilule (reverse) + gouttes
         inversées. Géométrie pilotée en JS. */
      .pch-wrap.closing {
        transition:
          left .42s cubic-bezier(.6,.04,.2,1),
          top .42s cubic-bezier(.6,.04,.2,1),
          width .42s cubic-bezier(.6,.04,.2,1),
          height .42s cubic-bezier(.6,.04,.2,1),
          opacity .36s ease .04s;
        opacity: 0;
      }
      .pch-wrap.closing,
      .pch-wrap.closing .pch-skin {
        animation: pch-liquid .42s cubic-bezier(.5,0,.2,1) reverse forwards;
      }
      .pch-wrap.dragging { transition: none !important; animation: none !important; }
      .pch-wrap.dragging .pch-skin,
      .pch-wrap.dragging .pch-goolayer i { animation: none !important; }

      /* reduced-motion : AUCUN liquide. Le panneau apparaît/disparaît en
         fondu+échelle court ; gouttes et keyframes neutralisées. */
      @media (prefers-reduced-motion:reduce){
        .pch-wrap.open{
          transition:opacity .2s ease, transform .2s ease,
                     left .2s ease, top .2s ease, width .2s ease, height .2s ease;
        }
        .pch-wrap.morphing,.pch-wrap.morphing .pch-skin,
        .pch-wrap.closing,.pch-wrap.closing .pch-skin{animation:none!important}
        .pch-wrap.closing{transition:opacity .18s ease,left .2s,top .2s,width .2s,height .2s}
        .pch-goolayer{display:none!important}
      }
    </style>
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <defs>
        <filter id="pch-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/>
          <feColorMatrix in="b" mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="g"/>
          <feBlend in="SourceGraphic" in2="g"/>
        </filter>
      </defs>
    </svg>
    <div class="pch-wrap" id="wrap">
      <div class="pch-goolayer"><i class="b1"></i><i class="b2"></i></div>
      <div class="pch-skin"></div>
    </div>
    <button class="pch-launch" id="launch" type="button"
            title="Assistant PC Helper" aria-label="Ouvrir l'assistant PC Helper">
      <span class="ic">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <rect x="3" y="4" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/>
          <path d="M8.5 21h7M12 17v4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M7.5 10.5l2.4 2.4 4.6-4.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="dot" aria-hidden="true"></span>
      <span class="lbl">PC Helper</span>
    </button>
  `

  const wrap = shadow.getElementById('wrap')
  // .pch-skin enveloppe l'iframe (porte clip + border-radius liquide) ;
  // .pch-wrap reste la BOÎTE animée (géométrie/morph). L'iframe est
  // appendée dans .pch-skin, jamais directement dans #wrap.
  const skin = wrap.querySelector('.pch-skin')
  const launch = shadow.getElementById('launch')
  let monte = false
  let anime = false
  let iframe = null

  try {
    chrome.storage.local.get('pchGeo', (v) => {
      if (v && v.pchGeo && TAILLES[v.pchGeo.preset]) geo = v.pchGeo
    })
  } catch {}

  // Position STABLE du lanceur, calculée depuis sa position CSS fixe
  // (right/bottom/taille). On n'utilise pas getBoundingClientRect : quand
  // le lanceur est `.gone` (scale .2), le rect renvoyé est faux et le morph
  // de fermeture visait alors un mauvais point.
  // Gabarit RECTANGULAIRE de la pilule « Beacon » au repos (DA itér. 2) :
  // largeur ≈ 188 (libellé « PC Helper » visible), hauteur 60, ancrée
  // right/bottom 22. Le morph d'ouverture/fermeture part/atterrit PILE
  // sur cette boîte (cf. ouvrir()/fermer() : départ wrap = rectLanceur()).
  const LAN = { w: 188, h: 60, right: 22, bottom: 22 }
  function rectLanceur() {
    return {
      left: window.innerWidth - LAN.right - LAN.w,
      top: window.innerHeight - LAN.bottom - LAN.h,
      w: LAN.w, h: LAN.h
    }
  }

  /* ----------------------------------------------------------------------
   * Garde anti-deadlock : `anime` ne doit JAMAIS rester bloqué à true.
   * Chaque passage à `anime=true` arme un watchdog indépendant qui, si la
   * séquence normale ne l'a pas relâché à temps, force un état DOM cohérent.
   * Aucune ouverture/fermeture ne dépend plus d'un seul rAF/setTimeout non
   * garanti : un repli setTimeout couvre toujours le frame non servi.
   * -------------------------------------------------------------------- */
  let watchdog = null
  function armerWatchdog(ms, onTimeout) {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      watchdog = null
      try { onTimeout() } catch {}
    }, ms)
  }
  function desarmerWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null }
  }

  // État DOM « ouvert visible » garanti, sans animation : utilisé en repli.
  function forcerOuvertVisible() {
    const fin = cible()
    wrap.classList.remove('closing', 'morphing', 'settle')
    wrap.classList.add('show', 'open', 'revealed')
    wrap.style.left = fin.left + 'px'
    wrap.style.top = fin.top + 'px'
    wrap.style.width = fin.w + 'px'
    wrap.style.height = fin.h + 'px'
    wrap.style.borderRadius = ''
    launch.classList.add('gone')
    anime = false
  }

  // État DOM « fermé » garanti, sans animation : utilisé en repli.
  function forcerFerme() {
    wrap.classList.remove('open', 'revealed', 'closing', 'morphing', 'settle', 'show')
    wrap.style.borderRadius = ''
    launch.classList.remove('gone')
    anime = false
  }

  function monterIframe() {
    if (monte) return
    const f = document.createElement('iframe')
    f.className = 'pch-frame'
    f.src = chrome.runtime.getURL('panel/panel.html')
    f.allow = 'clipboard-write'
    iframe = f
    let charge = false
    // Succès : l'iframe a peint -> on lève le contenu si le morph est passé.
    f.addEventListener('load', () => {
      charge = true
      if (wrap.classList.contains('open')) wrap.classList.add('revealed')
    })
    // Garde : si `load` n'arrive pas (CSP frame-src de la page hôte qui
    // bloque le chrome-extension://, ou non-peinture), on bascule sur le
    // panneau en fenêtre autonome via le service worker.
    setTimeout(() => {
      if (charge || !monte) return
      // L'iframe n'a jamais chargé : on referme proprement le wrap et on
      // demande au SW d'ouvrir le panneau en fenêtre dédiée (hors CSP hôte).
      forcerFerme()
      monte = false
      try { iframe && iframe.remove() } catch {}
      iframe = null
      try {
        chrome.runtime.sendMessage({ type: 'PCHELPER_OPEN_WINDOW' }, () => {
          void chrome.runtime.lastError // canal volatil : on absorbe l'erreur
        })
      } catch {}
    }, 1500)
    skin.appendChild(f)
    monte = true
  }

  function ouvrir() {
    // Idempotence : si déjà ouvert ET visible, ne rien faire. Si le wrap est
    // censé être monté mais incohérent/invisible (deadlock résiduel), on
    // force l'état ouvert visible plutôt que de sortir en silence.
    if (wrap.classList.contains('open')) {
      const visible = wrap.classList.contains('show') &&
        getComputedStyle(wrap).opacity !== '0'
      if (!visible) { desarmerWatchdog(); forcerOuvertVisible() }
      return
    }
    if (anime) return
    try {
      anime = true
      monterIframe()
      const dep = rectLanceur()
      const fin = cible()

      // État initial : à l'emplacement du lanceur, en pastille ronde.
      // Contenu masqué (revealed retiré) pour éviter le flash écrasé.
      wrap.classList.remove('closing', 'open', 'revealed', 'settle')
      wrap.classList.add('show')
      wrap.style.left = dep.left + 'px'
      wrap.style.top = dep.top + 'px'
      wrap.style.width = dep.w + 'px'
      wrap.style.height = dep.h + 'px'
      // Départ PILE sur la pilule Beacon (rayon 30px = .pch-launch),
      // pas un cercle : la boîte n'est plus carrée (188x60).
      wrap.style.borderRadius = '30px'
      // Le lanceur « fond » dans la bulle.
      launch.classList.add('gone')

      // Watchdog déterministe : quoi qu'il arrive (frame non servi, anim
      // jamais finie), l'état « ouvert visible » est garanti et `anime`
      // relâché. ~1300 ms > durée morph (~640 ms) + marge.
      armerWatchdog(1300, forcerOuvertVisible)

      // Reflow puis cible -> morph liquide. rAF AVEC repli setTimeout : si
      // le frame n'est pas servi (onglet caché…), le setTimeout prend le
      // relais et la séquence d'ouverture s'exécute quand même.
      void wrap.offsetWidth
      let demarre = false
      const demarrerMorph = () => {
        if (demarre) return
        demarre = true
        wrap.classList.add('open', 'morphing')
        wrap.style.left = fin.left + 'px'
        wrap.style.top = fin.top + 'px'
        wrap.style.width = fin.w + 'px'
        wrap.style.height = fin.h + 'px'
        // Le contenu apparaît une fois la bulle suffisamment ouverte
        // (~240 ms : la masse liquide a assez « coulé », spec DA v3).
        setTimeout(() => {
          if (wrap.classList.contains('open')) wrap.classList.add('revealed')
        }, 240)
        // Fin du morph : repli garanti même sans transitionend.
        const finirMorph = () => {
          wrap.classList.remove('morphing')
          wrap.style.borderRadius = ''
          desarmerWatchdog()
          anime = false
        }
        let fini = false
        const once = () => { if (!fini) { fini = true; finirMorph() } }
        wrap.addEventListener('transitionend', function te(ev) {
          if (ev.propertyName === 'width' || ev.propertyName === 'height') {
            wrap.removeEventListener('transitionend', te)
            once()
          }
        })
        // Garde ~620 ms (spec DA v3 : retrait morphing + reset radius) si
        // transitionend n'arrive pas. < watchdog 1300 ms : marge intacte.
        setTimeout(once, 620)
      }
      requestAnimationFrame(demarrerMorph)
      setTimeout(demarrerMorph, 60) // repli si rAF non servi
    } catch {
      // Toute exception : on garantit un état cohérent et `anime` relâché.
      desarmerWatchdog()
      forcerOuvertVisible()
    }
  }

  function fermer() {
    if (!wrap.classList.contains('open')) return
    if (anime) return
    try {
      anime = true
      const dep = rectLanceur()
      wrap.classList.remove('open', 'revealed') // contenu masqué pendant le repli
      wrap.classList.add('closing')
      wrap.style.left = dep.left + 'px'
      wrap.style.top = dep.top + 'px'
      wrap.style.width = dep.w + 'px'
      wrap.style.height = dep.h + 'px'

      // Watchdog : l'état fermé est garanti même si l'anim ne finit pas.
      armerWatchdog(900, forcerFerme)

      const finirFermeture = () => {
        wrap.classList.remove('show', 'closing')
        wrap.style.borderRadius = '' // la base CSS reprend la main
        launch.classList.remove('gone')
        desarmerWatchdog()
        anime = false
      }
      let fini = false
      const once = () => { if (!fini) { fini = true; finirFermeture() } }
      wrap.addEventListener('transitionend', function te(ev) {
        if (ev.propertyName === 'opacity') {
          wrap.removeEventListener('transitionend', te)
          once()
        }
      })
      // Garde ~460 ms (spec DA v3 : fin fermeture) si transitionend
      // n'arrive pas. < watchdog 900 ms : marge de sécurité intacte.
      setTimeout(once, 460)
    } catch {
      desarmerWatchdog()
      forcerFerme()
    }
  }

  const basculer = () => (wrap.classList.contains('open') ? fermer() : ouvrir())
  launch.addEventListener('click', basculer)

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PCHELPER_TOGGLE') basculer()
  })

  /* ---------------- Drag fiable (coords écran) + réglages -------------- */
  let drag = null
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.__pchelper == null) return
    // Sécurité : ces commandes (déplacer/fermer/redimensionner) ne sont
    // acceptées QUE depuis notre propre panneau, jamais depuis la page hôte.
    if (!iframe || e.source !== iframe.contentWindow) return

    if (d.__pchelper === 'closePanel') {
      fermer()
    } else if (d.__pchelper === 'dragStart') {
      // On fige la position de départ une seule fois : les deltas envoyés
      // par le panneau sont en coordonnées ÉCRAN (indépendantes de l'iframe
      // qui se déplace), donc pas de boucle de retour ni de saut.
      const r = wrap.getBoundingClientRect()
      drag = { ox: r.left, oy: r.top }
      wrap.classList.add('dragging')
    } else if (d.__pchelper === 'dragMove' && drag) {
      const { w, h } = dims()
      geo.left = clamp(drag.ox + d.dx, MARGE, window.innerWidth - w - MARGE)
      geo.top = clamp(drag.oy + d.dy, MARGE, window.innerHeight - h - MARGE)
      wrap.style.left = geo.left + 'px'
      wrap.style.top = geo.top + 'px'
    } else if (d.__pchelper === 'dragEnd' && drag) {
      drag = null
      wrap.classList.remove('dragging')
      // Atterrissage : micro-respiration élastique, discrète et voulue.
      wrap.classList.remove('settle')
      void wrap.offsetWidth
      wrap.classList.add('settle')
      setTimeout(() => wrap.classList.remove('settle'), 380)
      persister()
    } else if (d.__pchelper === 'setSize' && TAILLES[d.preset]) {
      geo.preset = d.preset
      const f = cible()
      wrap.style.transition = 'left .42s cubic-bezier(.34,1.3,.5,1), top .42s cubic-bezier(.34,1.3,.5,1), width .42s cubic-bezier(.34,1.3,.5,1), height .42s cubic-bezier(.34,1.3,.5,1)'
      wrap.style.left = f.left + 'px'
      wrap.style.top = f.top + 'px'
      wrap.style.width = f.w + 'px'
      wrap.style.height = f.h + 'px'
      persister()
    } else if (d.__pchelper === 'resetPos') {
      geo.left = null; geo.top = null
      const f = cible()
      wrap.style.transition = 'left .42s cubic-bezier(.34,1.3,.5,1), top .42s cubic-bezier(.34,1.3,.5,1)'
      wrap.style.left = f.left + 'px'
      wrap.style.top = f.top + 'px'
      persister()
    }
  })

  window.addEventListener('resize', () => {
    if (wrap.classList.contains('open') && !drag) {
      const f = cible()
      wrap.style.left = f.left + 'px'
      wrap.style.top = f.top + 'px'
      wrap.style.width = f.w + 'px'
      wrap.style.height = f.h + 'px'
    }
  })
})()
