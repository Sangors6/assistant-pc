/* PC Helper — content script (toutes les pages).
 *  - Injecte un lanceur flottant + le panneau (iframe d'une page d'extension).
 *  - Sur l'origine du site PC Helper uniquement : sert de pont matériel
 *    (la page demande, on relaie au service worker, on renvoie le résultat).
 */
(function () {
  // Une seule instance, et seulement dans la frame principale.
  if (window.top !== window || window.__pcHelperInjecte) return
  window.__pcHelperInjecte = true

  const ORIGINES_SITE = [
    'https://assistant-pc.onrender.com',
    'http://localhost:3000',
    'http://localhost:3010',
    'http://localhost:3011'
  ]

  /* ---------------- Pont matériel (origine du site seulement) ----------- */
  // Sécurité : on n'expose jamais le matériel à un site tiers.
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
    // Signale la présence de l'extension à la page.
    window.postMessage({ __pchelper: 'present' }, location.origin)
  }

  /* ---------------- Lanceur + panneau flottant ------------------------- */
  const hote = document.createElement('div')
  hote.id = 'pchelper-host'
  hote.style.cssText = 'all:initial;position:fixed;z-index:2147483647;'
  const shadow = hote.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(hote)

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .pch-launch {
        position: fixed; right: 22px; bottom: 22px; width: 54px; height: 54px;
        border-radius: 50%; cursor: pointer; border: none;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        box-shadow: 0 8px 28px rgba(37,99,235,.45);
        display: flex; align-items: center; justify-content: center;
        font-size: 24px; transition: transform .18s ease, box-shadow .18s ease;
      }
      .pch-launch:hover { transform: translateY(-2px) scale(1.05);
        box-shadow: 0 12px 34px rgba(37,99,235,.6); }
      .pch-wrap {
        position: fixed; right: 22px; bottom: 88px;
        width: 400px; height: 620px; max-height: calc(100vh - 120px);
        border-radius: 18px; overflow: hidden; display: none;
        box-shadow: 0 24px 70px rgba(0,0,0,.55);
        border: 1px solid rgba(59,130,246,.3);
        background: #060910; opacity: 0; transform: translateY(14px);
        transition: opacity .22s ease, transform .22s ease;
      }
      .pch-wrap.open { display: block; opacity: 1; transform: translateY(0); }
      .pch-wrap iframe { width: 100%; height: 100%; border: none; display: block; }
      @media (max-width: 480px) {
        .pch-wrap { right: 12px; left: 12px; width: auto; bottom: 84px; }
      }
    </style>
    <div class="pch-wrap" id="wrap"></div>
    <button class="pch-launch" id="launch" title="PC Helper">🖥️</button>
  `

  const wrap = shadow.getElementById('wrap')
  const launch = shadow.getElementById('launch')
  let monte = false

  function ouvrir() {
    if (!monte) {
      const f = document.createElement('iframe')
      f.src = chrome.runtime.getURL('panel/panel.html')
      f.allow = 'clipboard-write'
      wrap.appendChild(f)
      monte = true
    }
    wrap.classList.add('open')
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

  // Clic sur l'icône de la barre d'outils (relayé par le service worker).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PCHELPER_TOGGLE') basculer()
  })

  // Le panneau peut demander sa propre fermeture.
  window.addEventListener('message', (e) => {
    if (e.data && e.data.__pchelper === 'closePanel') fermer()
  })
})()
