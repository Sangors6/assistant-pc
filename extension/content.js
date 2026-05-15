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
        window.postMessage({
          __pchelper: 'hwRes',
          id: d.id,
          ok: !!(rep && rep.ok),
          data: rep && rep.data ? rep.data : null
        }, location.origin)
      })
    })
    window.postMessage({ __pchelper: 'present' }, location.origin)
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

      /* ---- Lanceur très visible : orbe + anneau conique rotatif ---- */
      @keyframes pch-spin { to { transform: rotate(360deg); } }
      @keyframes pch-halo {
        0%,100% { box-shadow: 0 14px 40px rgba(37,99,235,.55), 0 0 0 0 rgba(59,130,246,.5); }
        50%     { box-shadow: 0 18px 52px rgba(37,99,235,.7), 0 0 0 16px rgba(59,130,246,0); }
      }
      @keyframes pch-liquid {
        0%   { border-radius: 50%; }
        35%  { border-radius: 46% 54% 60% 40% / 55% 45% 58% 42%; }
        70%  { border-radius: 32% 30% 28% 30% / 30% 28% 32% 30%; }
        100% { border-radius: 24px; }
      }
      .pch-launch {
        position: fixed; right: 22px; bottom: 22px; width: 66px; height: 66px;
        border-radius: 50%; cursor: pointer; border: none; padding: 0;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-size: 27px; isolation: isolate;
        background: linear-gradient(150deg,#60a5fa,#3b82f6 45%,#1d4ed8);
        animation: pch-halo 2.8s ease-in-out infinite;
        transition: transform .34s cubic-bezier(.34,1.56,.64,1),
                    opacity .26s ease, border-radius .3s ease;
      }
      .pch-launch::before {            /* anneau conique lumineux rotatif */
        content: ''; position: absolute; inset: -3px; border-radius: inherit;
        background: conic-gradient(from 0deg, #22d3ee, #3b82f6, #6366f1, #22d3ee);
        animation: pch-spin 4s linear infinite; z-index: -1;
        filter: blur(5px); opacity: .85;
      }
      .pch-launch::after {             /* reflet verre interne */
        content: ''; position: absolute; inset: 0; border-radius: inherit;
        background: radial-gradient(120% 90% at 30% 18%, rgba(255,255,255,.5), transparent 55%);
      }
      .pch-launch .ic { position: relative; z-index: 1;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
      .pch-launch:hover { transform: translateY(-4px) scale(1.07); }
      .pch-launch:hover .ic { transform: rotate(-8deg) scale(1.08); }
      .pch-launch:active { transform: scale(.9); }
      .pch-launch.gone { transform: scale(.2); opacity: 0; pointer-events: none; }

      /* ---- Panneau : morph liquide depuis le lanceur ---- */
      .pch-wrap {
        position: fixed; left: 0; top: 0; width: 66px; height: 66px;
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
    <button class="pch-launch" id="launch" title="Assistant PC Helper">
      <span class="ic">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <rect x="3" y="4" width="18" height="13" rx="2.5" fill="none" stroke="#fff" stroke-width="1.9"/>
          <path d="M8.5 21h7M12 17v4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M7.5 10.5l2.4 2.4 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
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
  const LAN = { size: 66, right: 22, bottom: 22 }
  function rectLanceur() {
    return {
      left: window.innerWidth - LAN.right - LAN.size,
      top: window.innerHeight - LAN.bottom - LAN.size,
      w: LAN.size, h: LAN.size
    }
  }

  function ouvrir() {
    if (anime || wrap.classList.contains('open')) return
    anime = true
    if (!monte) {
      const f = document.createElement('iframe')
      f.src = chrome.runtime.getURL('panel/panel.html')
      f.allow = 'clipboard-write'
      iframe = f
      wrap.appendChild(f)
      monte = true
    }
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

    // Reflow puis cible -> morph liquide.
    void wrap.offsetWidth
    requestAnimationFrame(() => {
      wrap.classList.add('open', 'morphing')
      wrap.style.left = fin.left + 'px'
      wrap.style.top = fin.top + 'px'
      wrap.style.width = fin.w + 'px'
      wrap.style.height = fin.h + 'px'
      // Le contenu apparaît une fois la bulle suffisamment ouverte.
      setTimeout(() => wrap.classList.add('revealed'), 220)
      setTimeout(() => {
        // Fin du morph : on retire la classe d'animation transitoire et le
        // rayon inline -> la base CSS (24px) gouverne, le morph ne peut
        // plus être rejoué (fin de drag = plus de cercle).
        wrap.classList.remove('morphing')
        wrap.style.borderRadius = ''
        anime = false
      }, 640)
    })
  }

  function fermer() {
    if (anime || !wrap.classList.contains('open')) return
    anime = true
    const dep = rectLanceur()
    wrap.classList.remove('open', 'revealed') // contenu masqué pendant le repli
    wrap.classList.add('closing')
    wrap.style.left = dep.left + 'px'
    wrap.style.top = dep.top + 'px'
    wrap.style.width = dep.w + 'px'
    wrap.style.height = dep.h + 'px'
    setTimeout(() => {
      wrap.classList.remove('show', 'closing')
      wrap.style.borderRadius = '' // la base CSS reprend la main
      launch.classList.remove('gone')
      anime = false
    }, 420)
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
