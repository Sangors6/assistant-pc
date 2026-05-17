/* PC Helper — service worker (MV3).
 * Deux responsabilités :
 *  1) Lire le VRAI matériel via chrome.system.* (indisponible ailleurs).
 *  2) Basculer le panneau flottant quand on clique l'icône de la barre.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Charge CPU réelle : les compteurs system.cpu sont cumulatifs depuis le
// boot, il faut donc deux échantillons espacés pour en déduire un %.
async function lireCpu() {
  const a = await chrome.system.cpu.getInfo()
  await sleep(450)
  const b = await chrome.system.cpu.getInfo()
  let totalDelta = 0
  let idleDelta = 0
  for (let i = 0; i < b.processors.length; i++) {
    const u1 = a.processors[i] && a.processors[i].usage
    const u2 = b.processors[i] && b.processors[i].usage
    if (!u1 || !u2) continue
    totalDelta += u2.total - u1.total
    idleDelta += u2.idle - u1.idle
  }
  const charge = totalDelta > 0
    ? Math.round((1 - idleDelta / totalDelta) * 100)
    : 0
  return {
    modele: b.modelName || 'CPU',
    coeurs: b.numOfProcessors || b.processors.length,
    architecture: b.archName || '',
    charge: Math.max(0, Math.min(100, charge))
  }
}

async function lireMemoire() {
  const m = await chrome.system.memory.getInfo()
  const totalGo = m.capacity / 1e9
  const dispoGo = m.availableCapacity / 1e9
  const utiliseGo = totalGo - dispoGo
  const pct = m.capacity > 0
    ? Math.round((utiliseGo / totalGo) * 100)
    : 0
  return {
    totalGo: Math.round(totalGo * 10) / 10,
    utiliseGo: Math.round(utiliseGo * 10) / 10,
    pct: Math.max(0, Math.min(100, pct))
  }
}

async function lireEcrans() {
  try {
    const d = await chrome.system.display.getInfo()
    const p = d && d[0] && d[0].bounds
    return p ? `${p.width}×${p.height}` + (d.length > 1 ? ` (+${d.length - 1})` : '') : null
  } catch {
    return null
  }
}

async function collecterMateriel() {
  // Chaque lecture est isolée : une API indisponible ne casse pas le reste.
  const [cpu, memoire, ecran] = await Promise.all([
    lireCpu().catch(() => null),
    lireMemoire().catch(() => null),
    lireEcrans().catch(() => null)
  ])
  return { cpu, memoire, ecran, source: 'extension' }
}

/* ----------------------------------------------------------------------
 * Repli « panneau en fenêtre dédiée ».
 *  Ouvre une ressource PROPRE de l'extension (panel/panel.html) : aucune
 *  permission supplémentaire requise, et NON soumis à la CSP d'une page
 *  hôte. Utilisé quand l'onglet n'est pas scriptable (chrome://, newtab,
 *  Web Store, PDF, page d'erreur, content script orphelin après reload)
 *  OU quand l'iframe incrustée a été bloquée (CSP frame-src de la page).
 *  Anti-doublon : on mémorise l'id de fenêtre et on la refocalise.
 * -------------------------------------------------------------------- */
let panneauWindowId = null

async function ouvrirPanneauFenetre() {
  const url = chrome.runtime.getURL('panel/panel.html')

  // Réutiliser la fenêtre déjà ouverte plutôt que d'en empiler une autre.
  if (panneauWindowId != null) {
    try {
      const w = await chrome.windows.get(panneauWindowId)
      if (w) { await chrome.windows.update(panneauWindowId, { focused: true }); return }
    } catch {
      panneauWindowId = null // fenêtre fermée entre-temps
    }
  }
  // Filet anti-doublon supplémentaire : retrouver une fenêtre panneau
  // existante même si l'id a été perdu (SW redémarré).
  try {
    const toutes = await chrome.windows.getAll({ populate: true })
    for (const w of toutes) {
      const t = w.tabs && w.tabs[0]
      if (t && t.url && t.url.startsWith(url)) {
        panneauWindowId = w.id
        await chrome.windows.update(w.id, { focused: true })
        return
      }
    }
  } catch {}

  try {
    const win = await chrome.windows.create({
      url, type: 'popup', width: 440, height: 700
    })
    panneauWindowId = win && win.id != null ? win.id : null
  } catch {
    // chrome.windows indisponible : repli ultime via un onglet.
    try { await chrome.tabs.create({ url }) } catch {}
  }
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === panneauWindowId) panneauWindowId = null
})

// Feedback explicite quand AUCUN contexte n'est possible : jamais un échec
// 100 % muet. Badge éphémère sur l'icône de la barre.
function feedbackEchec() {
  try {
    chrome.action.setBadgeBackgroundColor({ color: '#b45309' })
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setTitle({ title: 'PC Helper — impossible d’ouvrir ici' })
    setTimeout(() => {
      try {
        chrome.action.setBadgeText({ text: '' })
        chrome.action.setTitle({ title: 'Ouvrir PC Helper' })
      } catch {}
    }, 4000)
  } catch {}
}

// Messages venant de content.js / panel.js.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'PCHELPER_HW') {
    collecterMateriel()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, erreur: String(e && e.message || e) }))
    return true // réponse asynchrone
  }
  // content.js demande le repli fenêtre (iframe bloquée par CSP hôte…).
  if (msg && msg.type === 'PCHELPER_OPEN_WINDOW') {
    ouvrirPanneauFenetre()
    return false
  }
})

// Clic sur l'icône de la barre d'outils : on demande au content script
// d'afficher/masquer le panneau dans l'onglet actif. Si l'onglet n'est pas
// scriptable (lastError), repli GARANTI sur le panneau en fenêtre dédiée.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) { ouvrirPanneauFenetre(); return }
  chrome.tabs.sendMessage(tab.id, { type: 'PCHELPER_TOGGLE' }, () => {
    // Lecture explicite de lastError : sans content script joignable, le
    // message échoue silencieusement -> on bascule sur la fenêtre dédiée.
    if (chrome.runtime.lastError) {
      ouvrirPanneauFenetre().catch(() => feedbackEchec())
    }
  })
})
