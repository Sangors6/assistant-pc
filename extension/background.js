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

// Messages venant de content.js / panel.js.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'PCHELPER_HW') {
    collecterMateriel()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, erreur: String(e && e.message || e) }))
    return true // réponse asynchrone
  }
})

// Clic sur l'icône de la barre d'outils : on demande au content script
// d'afficher/masquer le panneau dans l'onglet actif.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'PCHELPER_TOGGLE' })
  } catch {
    // Pas de content script (page interne chrome://, store…) : on ignore.
  }
})
