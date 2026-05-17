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

      /* ---- Lanceur « Dynamic Capsule » (refonte DA) ---- */
      /* Apparition unique au montage : la capsule « se pose » (pas de boucle). */
      @keyframes pch-arrive{
        0%{opacity:0;transform:translateY(14px) scale(.82)}
        60%{opacity:1}
        100%{opacity:1;transform:translateY(0) scale(1)}
      }
      /* Pulsation TRÈS lente et discrète du liseré (vie, pas néon). */
      @keyframes pch-breathe{
        0%,100%{opacity:.55}
        50%{opacity:.9}
      }
      @keyframes pch-liquid {
        0%   { border-radius: 50%; }
        35%  { border-radius: 46% 54% 60% 40% / 55% 45% 58% 42%; }
        70%  { border-radius: 32% 30% 28% 30% / 30% 28% 32% 30%; }
        100% { border-radius: 24px; }
      }

      /* — Conteneur : capsule sombre dense, ancrée bas-droite — */
      .pch-launch{
        position:fixed; right:22px; bottom:22px;
        /* Au repos : capsule compacte (juste l'icône, coins très arrondis). */
        height:56px; min-width:56px; padding:0 16px;
        border:none; cursor:pointer; isolation:isolate;
        display:flex; align-items:center; gap:0;
        color:#f3f5f9; font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        letter-spacing:.01em; white-space:nowrap;
        border-radius:28px;
        /* Matière : obsidienne profonde, dégradé vertical subtil + grain de
           lumière froide en haut (verre dépoli, pas plastique). */
        background:
          radial-gradient(120% 140% at 50% 0%,rgba(86,124,255,.20),transparent 60%),
          linear-gradient(180deg,#1c2030 0%,#0e1118 60%,#080a0f 100%);
        box-shadow:
          0 1px 0 rgba(255,255,255,.10) inset,            /* arête haute (verre) */
          0 0 0 1px rgba(255,255,255,.06) inset,          /* contour interne */
          0 18px 40px -12px rgba(0,0,0,.65),              /* ombre portée dense */
          0 6px 16px -8px rgba(0,0,0,.55);
        transition:
          width .42s cubic-bezier(.34,1.4,.5,1),
          padding .42s cubic-bezier(.34,1.4,.5,1),
          transform .34s cubic-bezier(.34,1.56,.64,1),
          box-shadow .34s ease, opacity .26s ease,
          border-radius .3s ease;
        animation:pch-arrive .62s cubic-bezier(.34,1.4,.5,1) both;
      }
      /* Liseré lumineux périmétrique — fin, froid, vivant mais NON criard. */
      .pch-launch::before{
        content:""; position:absolute; inset:0; border-radius:inherit; z-index:-1;
        padding:1px;
        background:linear-gradient(135deg,
          rgba(120,150,255,.85),rgba(70,90,160,.15) 38%,
          rgba(60,75,130,.12) 62%,rgba(150,170,255,.7));
        -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
        -webkit-mask-composite:xor; mask-composite:exclude;
        animation:pch-breathe 5.5s ease-in-out infinite;
      }
      /* Halo doux projeté SOUS la capsule : la détache de la page hôte. */
      .pch-launch::after{
        content:""; position:absolute; left:50%; bottom:-9px; z-index:-2;
        width:72%; height:22px; transform:translateX(-50%);
        background:radial-gradient(50% 100% at 50% 0%,rgba(70,100,220,.40),transparent 75%);
        filter:blur(7px); opacity:.7; transition:opacity .34s ease;
      }

      /* — L'icône (hook .ic conservé, SVG inline) — */
      .pch-launch .ic{
        position:relative; z-index:1; display:flex;
        width:24px; height:24px; flex:none;
        color:#fff;
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));
        transition:transform .34s cubic-bezier(.34,1.56,.64,1);
      }
      .pch-launch .ic svg{width:24px;height:24px;display:block}

      /* — Le libellé : caché au repos, révélé au survol/focus (Dynamic Island). — */
      .pch-launch .lbl{
        position:relative; z-index:1;
        max-width:0; opacity:0; overflow:hidden;
        margin-left:0;
        transform:translateX(-4px);
        transition:max-width .42s cubic-bezier(.34,1.4,.5,1),
                   opacity .26s ease .06s,
                   margin-left .42s cubic-bezier(.34,1.4,.5,1),
                   transform .42s cubic-bezier(.34,1.4,.5,1);
      }
      /* Point d'état discret avant le libellé (vie système, pas gadget). */
      .pch-launch .dot{
        position:relative; z-index:1; flex:none;
        width:6px; height:6px; border-radius:50%;
        background:#5ee0a8; box-shadow:0 0 8px rgba(94,224,168,.9);
        max-width:0; opacity:0; margin-left:0;
        transition:max-width .42s cubic-bezier(.34,1.4,.5,1),
                   opacity .24s ease, margin-left .42s cubic-bezier(.34,1.4,.5,1);
      }

      /* — ÉVEIL : hover / focus-clavier → la capsule s'étire en pilule — */
      .pch-launch:hover,
      .pch-launch:focus-visible{
        transform:translateY(-3px);
        box-shadow:
          0 1px 0 rgba(255,255,255,.14) inset,
          0 0 0 1px rgba(255,255,255,.08) inset,
          0 26px 54px -14px rgba(0,0,0,.7),
          0 10px 24px -10px rgba(40,70,180,.45);
      }
      .pch-launch:hover::after,
      .pch-launch:focus-visible::after{opacity:1}
      .pch-launch:hover .lbl,
      .pch-launch:focus-visible .lbl{
        max-width:130px; opacity:1; margin-left:10px; transform:translateX(0);
      }
      .pch-launch:hover .dot,
      .pch-launch:focus-visible .dot{
        max-width:6px; opacity:1; margin-left:10px;
      }
      .pch-launch:hover .ic,
      .pch-launch:focus-visible .ic{transform:scale(1.06)}

      /* Focus clavier net (a11y) — anneau froid net, pas de flash coloré. */
      .pch-launch:focus-visible{
        outline:2px solid rgba(150,175,255,.9); outline-offset:3px;
      }
      .pch-launch:active{transform:translateY(-1px) scale(.97)}

      /* — Hook JS INCHANGÉ : disparition quand le panneau s'ouvre — */
      .pch-launch.gone{transform:scale(.2); opacity:0; pointer-events:none}

      /* — Accessibilité mouvement : au repos AUCUN mouvement perpétuel. — */
      @media (prefers-reduced-motion:reduce){
        .pch-launch{animation:none}
        .pch-launch::before{animation:none; opacity:.7}
        .pch-launch,
        .pch-launch .lbl,
        .pch-launch .dot,
        .pch-launch .ic{transition:opacity .15s ease}
        .pch-launch:hover,
        .pch-launch:focus-visible{transform:none}
      }

      /* ---- Panneau : morph liquide depuis le lanceur ---- */
      .pch-wrap {
        position: fixed; left: 0; top: 0; width: 56px; height: 56px;
        border-radius: 24px; overflow: hidden; display: none;
        box-shadow: 0 30px 90px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.4);
        background: #06090f; opacity: 0;
        will-change: left, top, width, height, border-radius, opacity;
      }
      .pch-wrap iframe { opacity: 0; transition: opacity .3s ease .12s; }
      .pch-wrap.revealed iframe { opacity: 1; }
      .pch-wrap.show { display: block; }
      .pch-wrap.open {
        opacity: 1;
        transition:
          left .52s cubic-bezier(.6,.04,.2,1),
          top .52s cubic-bezier(.6,.04,.2,1),
          width .56s cubic-bezier(.34,1.3,.5,1),
          height .56s cubic-bezier(.34,1.3,.5,1),
          opacity .3s ease;
      }
      /* Morph liquide UNIQUEMENT à l'ouverture, classe transitoire :
         ainsi rien ne peut le rejouer (ex. fin de drag). */
      .pch-wrap.morphing { animation: pch-liquid .62s cubic-bezier(.5,0,.2,1) forwards; }
      /* Atterrissage subtil quand on relâche après un déplacement :
         une micro-respiration élastique, voulue et discrète. */
      @keyframes pch-settle {
        0%   { transform: scale(1); }
        38%  { transform: scale(1.015); }
        100% { transform: scale(1); }
      }
      .pch-wrap.settle { animation: pch-settle .36s cubic-bezier(.34,1.56,.64,1); }
      .pch-wrap.closing {
        transition: left .4s ease, top .4s ease, width .4s ease,
                    height .4s ease, opacity .34s ease, border-radius .4s ease;
        opacity: 0; border-radius: 50% !important;
      }
      .pch-wrap.dragging { transition: none !important; animation: none !important; }
      .pch-wrap iframe {
        width: 100%; height: 100%; border: none; display: block;
      }
    </style>
    <div class="pch-wrap" id="wrap"></div>
    <button class="pch-launch" id="launch" type="button"
            title="Assistant PC Helper" aria-label="Ouvrir l'assistant PC Helper">
      <span class="ic">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
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
  const LAN = { size: 56, right: 22, bottom: 22 }
  function rectLanceur() {
    return {
      left: window.innerWidth - LAN.right - LAN.size,
      top: window.innerHeight - LAN.bottom - LAN.size,
      w: LAN.size, h: LAN.size
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
    wrap.appendChild(f)
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
      wrap.style.borderRadius = '50%'
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
        // Le contenu apparaît une fois la bulle suffisamment ouverte.
        setTimeout(() => {
          if (wrap.classList.contains('open')) wrap.classList.add('revealed')
        }, 220)
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
        setTimeout(once, 700) // garde si transitionend n'arrive pas
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
      setTimeout(once, 480) // garde si transitionend n'arrive pas
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
