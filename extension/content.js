/* PC Helper — content script (toutes les pages).
 *  - Lanceur flottant iOS + panneau (iframe d'une page d'extension).
 *  - Panneau réglable : déplaçable (drag par l'en-tête) et 3 tailles,
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
    standard: { w: 400, h: 624 },
    large:    { w: 464, h: 730 }
  }
  const MARGE = 20
  let geo = { preset: 'standard', left: null, top: null } // left/top null = ancré bas-droite

  function dims() {
    const t = TAILLES[geo.preset] || TAILLES.standard
    return {
      w: Math.min(t.w, window.innerWidth - MARGE * 2),
      h: Math.min(t.h, window.innerHeight - MARGE * 2)
    }
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

  function appliquerGeo(animer) {
    const { w, h } = dims()
    wrap.style.width = w + 'px'
    wrap.style.height = h + 'px'
    let left = geo.left, top = geo.top
    if (left == null || top == null) {           // position par défaut : bas-droite
      left = window.innerWidth - w - MARGE
      top = window.innerHeight - h - MARGE
    }
    left = clamp(left, MARGE, Math.max(MARGE, window.innerWidth - w - MARGE))
    top = clamp(top, MARGE, Math.max(MARGE, window.innerHeight - h - MARGE))
    wrap.style.transition = animer
      ? 'left .42s cubic-bezier(.22,1,.36,1), top .42s cubic-bezier(.22,1,.36,1), width .42s cubic-bezier(.22,1,.36,1), height .42s cubic-bezier(.22,1,.36,1), opacity .26s ease, transform .42s cubic-bezier(.34,1.56,.64,1)'
      : 'opacity .26s ease, transform .42s cubic-bezier(.34,1.56,.64,1)'
    wrap.style.left = left + 'px'
    wrap.style.top = top + 'px'
  }

  function persister() {
    try { chrome.storage.local.set({ pchGeo: geo }) } catch {}
  }

  /* ---------------- DOM (shadow, isolé du site hôte) ------------------- */
  const hote = document.createElement('div')
  hote.id = 'pchelper-host'
  hote.style.cssText = 'all:initial;position:fixed;z-index:2147483647;'
  const shadow = hote.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(hote)

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      @keyframes pch-breathe {
        0%,100% { box-shadow: 0 10px 30px rgba(37,99,235,.42), 0 0 0 0 rgba(37,99,235,.35); }
        50%     { box-shadow: 0 12px 36px rgba(37,99,235,.52), 0 0 0 10px rgba(37,99,235,0); }
      }
      .pch-launch {
        position: fixed; right: 22px; bottom: 22px; width: 56px; height: 56px;
        border-radius: 20px; cursor: pointer; border: none; color:#fff;
        background: linear-gradient(150deg,#3b82f6,#2563eb 55%,#1d4ed8);
        display: flex; align-items: center; justify-content: center; font-size: 25px;
        animation: pch-breathe 3.6s ease-in-out infinite;
        transition: transform .32s cubic-bezier(.34,1.56,.64,1), border-radius .3s ease;
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      }
      .pch-launch:hover { transform: translateY(-3px) scale(1.06); border-radius: 24px; }
      .pch-launch:active { transform: scale(.92); }
      .pch-wrap {
        position: fixed; left: 0; top: 0; width: 400px; height: 624px;
        border-radius: 26px; overflow: hidden; display: none;
        box-shadow: 0 30px 90px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.4);
        background: #06090f; opacity: 0;
        transform: scale(.86); transform-origin: bottom right;
        will-change: transform, opacity, left, top;
      }
      .pch-wrap.open { display: block; opacity: 1; transform: scale(1); }
      .pch-wrap.dragging { transition: opacity .26s ease !important; }
      .pch-wrap iframe { width: 100%; height: 100%; border: none; display: block; }
    </style>
    <div class="pch-wrap" id="wrap"></div>
    <button class="pch-launch" id="launch" title="PC Helper">🖥️</button>
  `

  const wrap = shadow.getElementById('wrap')
  const launch = shadow.getElementById('launch')
  let monte = false

  try {
    chrome.storage.local.get('pchGeo', (v) => {
      if (v && v.pchGeo && TAILLES[v.pchGeo.preset]) geo = v.pchGeo
    })
  } catch {}

  function ouvrir() {
    if (!monte) {
      const f = document.createElement('iframe')
      f.src = chrome.runtime.getURL('panel/panel.html')
      f.allow = 'clipboard-write'
      wrap.appendChild(f)
      monte = true
    }
    appliquerGeo(false)
    requestAnimationFrame(() => wrap.classList.add('open'))
    launch.textContent = '✕'
  }
  function fermer() {
    wrap.classList.remove('open')
    launch.textContent = '🖥️'
  }
  function basculer() {
    wrap.classList.contains('open') ? fermer() : ouvrir()
  }

  launch.addEventListener('click', basculer)

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PCHELPER_TOGGLE') basculer()
  })

  /* ---------------- Drag + réglages (postMessage depuis le panneau) ---- */
  let drag = null
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.__pchelper == null) return

    if (d.__pchelper === 'closePanel') {
      fermer()
    } else if (d.__pchelper === 'dragStart') {
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
      persister()
    } else if (d.__pchelper === 'setSize' && TAILLES[d.preset]) {
      geo.preset = d.preset
      appliquerGeo(true)
      persister()
    } else if (d.__pchelper === 'resetPos') {
      geo.left = null; geo.top = null
      appliquerGeo(true)
      persister()
    }
  })

  window.addEventListener('resize', () => {
    if (wrap.classList.contains('open')) appliquerGeo(false)
  })
})()
