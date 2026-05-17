/* PC Helper — logique du panneau d'extension.
 * Page d'extension : host_permissions autorise les appels API cross-origin
 * (pas de CORS). Le JWT vit dans chrome.storage.local.
 */
const API_BASE = 'https://assistant-pc.onrender.com'

const store = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
  set: (k, val) => new Promise((r) => chrome.storage.local.set({ [k]: val }, r)),
  del: (k) => new Promise((r) => chrome.storage.local.remove(k, r))
}

const $ = (id) => document.getElementById(id)
const loginForm = $('login')
const chatView = $('chat')
const msgsEl = $('msgs')
const inputEl = $('input')
const sendBtn = $('send')
const loginErr = $('login-err')
const loginBtn = $('login-btn')
const logoutBtn = $('btn-logout')
const newBtn = $('btn-new')
const histBtn = $('btn-hist')
const settingsEl = $('settings')
const historyEl = $('history')
const WELCOME_HTML = $('welcome').outerHTML

let token = null
let sessionId = null

// Mode d'exécution : iframe incrustée dans une page (content.js gère le
// morph/drag via postMessage) OU fenêtre autonome dédiée (repli quand la
// page hôte n'est pas scriptable / CSP bloque l'iframe). En fenêtre, il n'y
// a pas de parent iframe : on neutralise proprement drag/redimensionnement
// et la fermeture devient window.close().
const EN_FENETRE = (window.top === window)
const versParent = (msg) => { if (!EN_FENETRE) parent.postMessage(msg, '*') }

/* ---------- Feuilles (réglages / historique), exclusives ---------- */
function fermerFeuilles(saufEl) {
  ;[settingsEl, historyEl].forEach((el) => { if (el !== saufEl) el.classList.remove('open') })
}
function basculerFeuille(el, onOpen) {
  const ouvre = !el.classList.contains('open')
  fermerFeuilles(el)
  el.classList.toggle('open', ouvre)
  if (ouvre && onOpen) onOpen()
}

$('btn-close').addEventListener('click', () => {
  if (EN_FENETRE) { try { window.close() } catch {} return }
  versParent({ __pchelper: 'closePanel' })
})
$('btn-set').addEventListener('click', () => basculerFeuille(settingsEl))
histBtn.addEventListener('click', () => basculerFeuille(historyEl, chargerHistorique))
newBtn.addEventListener('click', nouveauChat)

const seg = $('seg-size')
seg.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'))
    b.classList.add('on')
    versParent({ __pchelper: 'setSize', preset: b.dataset.size })
  })
})
$('reset-pos').addEventListener('click', () => versParent({ __pchelper: 'resetPos' }))
store.get('pchGeo').then((g) => {
  const preset = (g && g.preset) || 'standard'
  seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.size === preset))
})

// En fenêtre autonome, la taille/position du panneau sont gérées par la
// fenêtre du navigateur elle-même : ces réglages (qui pilotent l'iframe
// hôte) n'ont pas de sens ici -> on masque proprement le bloc + la poignée.
if (EN_FENETRE) {
  document.querySelectorAll('.set-block').forEach((b) => { b.style.display = 'none' })
  const hint = document.querySelector('.set-hint')
  if (hint) hint.textContent = 'Panneau ouvert en fenêtre dédiée (page non compatible avec l’incrustation).'
  const grab = $('grab'); if (grab) grab.style.display = 'none'
}

/* ---------- Déplacement (drag fiable : coordonnées ÉCRAN) ---------- */
function brancherDrag(el) {
  if (EN_FENETRE) return // en fenêtre autonome : la fenêtre se déplace seule
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return
    e.preventDefault()
    try { el.setPointerCapture(e.pointerId) } catch {}
    const sx = e.screenX, sy = e.screenY
    versParent({ __pchelper: 'dragStart' })
    const move = (ev) => versParent({ __pchelper: 'dragMove', dx: ev.screenX - sx, dy: ev.screenY - sy })
    const up = () => {
      versParent({ __pchelper: 'dragEnd' })
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  })
}
brancherDrag($('grab'))
brancherDrag($('hdr'))

/* ---------- Bascule connexion / chat ---------- */
function montrerLogin() {
  loginForm.style.display = 'flex'
  chatView.style.display = 'none'
  logoutBtn.style.display = 'none'
  newBtn.style.display = 'none'
  histBtn.style.display = 'none'
  fermerFeuilles()
}
function montrerChat() {
  loginForm.style.display = 'none'
  chatView.style.display = 'flex'
  logoutBtn.style.display = 'flex'
  newBtn.style.display = 'flex'
  histBtn.style.display = 'flex'
  chargerMateriel()
}

/* ---------- Matériel réel (via le service worker) ---------- */
function chargerMateriel() {
  const hw = $('hw')
  chrome.runtime.sendMessage({ type: 'PCHELPER_HW' }, (rep) => {
    // Canal volatil (SW MV3) : on lit lastError pour éviter l'échec muet.
    if (chrome.runtime.lastError || !rep || !rep.ok || !rep.data) { hw.style.display = 'none'; return }
    const d = rep.data
    const chips = []
    if (d.cpu) {
      chips.push(`<span class="chip">CPU <b>${d.cpu.charge}%</b></span>`)
      chips.push(`<span class="chip">${d.cpu.coeurs} <b>cœurs</b></span>`)
    }
    if (d.memoire) chips.push(`<span class="chip">RAM <b>${d.memoire.utiliseGo}/${d.memoire.totalGo} Go</b></span>`)
    if (d.ecran) chips.push(`<span class="chip">Écran <b>${d.ecran}</b></span>`)
    if (!chips.length) { hw.style.display = 'none' }
    else { hw.innerHTML = chips.join(''); hw.style.display = 'flex' }

    // 4.2 — message d'accueil personnalisé avec les vraies specs détectées,
    // intégré à l'écran d'accueil (zéro coût IA, design préservé).
    const w = document.getElementById('welcome')
    if (w && d && d.cpu) {
      const p = w.querySelector('p')
      if (p) {
        let txt = `Bonjour 👋 Configuration détectée : CPU à ${d.cpu.charge}%, ${d.cpu.coeurs} cœurs`
        if (d.memoire) txt += `, RAM ${d.memoire.utiliseGo}/${d.memoire.totalGo} Go`
        txt += '. Décris ton problème, ou choisis une piste :'
        p.textContent = txt
      }
    }
  })
}

/* ---------- Connectivité (4.1) ---------- */
const netbar = $('netbar')
let reconnectTimer = null
function setHorsLigne() {
  netbar.className = 'show warn'
  netbar.innerHTML = '<span class="pulse"></span> Serveur injoignable — nouvelle tentative…'
  if (!reconnectTimer) {
    reconnectTimer = setInterval(async () => {
      try {
        const r = await fetch(API_BASE + '/favicon.svg', { cache: 'no-store' })
        if (r && r.ok) setEnLigne()
      } catch {}
    }, 4000)
  }
}
function setEnLigne() {
  if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null }
  if (netbar.classList.contains('warn')) {
    netbar.className = 'show ok'
    netbar.innerHTML = '<span class="pulse"></span> Connexion rétablie'
    setTimeout(() => { netbar.className = ''; netbar.innerHTML = '' }, 2200)
  } else {
    netbar.className = ''
    netbar.innerHTML = ''
  }
}

/* ---------- Connexion / déconnexion ---------- */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  loginErr.textContent = ''
  loginBtn.disabled = true
  loginBtn.textContent = 'Connexion…'
  try {
    const res = await fetch(API_BASE + '/auth/connexion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value.trim(), motDePasse: $('mdp').value })
    })
    const data = await res.json().catch(() => ({}))
    setEnLigne()
    if (!res.ok) { loginErr.textContent = data.erreur || 'Connexion impossible.'; return }
    token = data.token
    await store.set('token', token)
    await store.set('email', data.email || '')
    montrerChat()
  } catch {
    loginErr.textContent = 'Réseau indisponible. Réessaie.'
    setHorsLigne()
  } finally {
    loginBtn.disabled = false
    loginBtn.textContent = 'Se connecter'
  }
})

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch(API_BASE + '/auth/deconnexion', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
    })
  } catch {}
  token = null
  sessionId = null
  await store.del('token')
  await store.del('sessionId')
  await store.del('email')
  montrerLogin()
})

/* ---------- Nouvelle conversation ---------- */
function nouveauChat() {
  sessionId = null
  store.del('sessionId')
  fermerFeuilles()
  msgsEl.innerHTML = WELCOME_HTML
  inputEl.value = ''
  inputEl.focus()
}

/* ---------- Historique ---------- */
async function chargerHistorique() {
  const liste = $('hist-list')
  liste.innerHTML = '<div class="hist-empty">Chargement…</div>'
  try {
    const res = await fetch(API_BASE + '/sessions', { headers: { 'Authorization': 'Bearer ' + token } })
    if (res.status === 401) { await sessionExpiree(); return }
    if (!res.ok) { liste.innerHTML = '<div class="hist-empty">Erreur de chargement.</div>'; return }
    const sessions = await res.json()
    if (!sessions.length) { liste.innerHTML = '<div class="hist-empty">Aucune conversation.</div>'; return }
    liste.innerHTML = ''
    sessions.forEach((s) => {
      const b = document.createElement('button')
      b.className = 'hist-item'
      const t = document.createElement('div'); t.className = 'h-t'
      t.textContent = (s.premier_message || 'Sans titre').slice(0, 60)
      const d = document.createElement('div'); d.className = 'h-d'
      d.textContent = new Date(s.derniere_activite).toLocaleDateString('fr-FR',
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      b.appendChild(t); b.appendChild(d)
      b.addEventListener('click', () => ouvrirConversation(s.session_id))
      liste.appendChild(b)
    })
  } catch {
    liste.innerHTML = '<div class="hist-empty">Réseau indisponible.</div>'
  }
}

async function ouvrirConversation(sid) {
  try {
    const res = await fetch(API_BASE + '/historique/' + sid, { headers: { 'Authorization': 'Bearer ' + token } })
    if (res.status === 401) { await sessionExpiree(); return }
    if (!res.ok) return
    const msgs = await res.json()
    sessionId = sid
    store.set('sessionId', sid)
    fermerFeuilles()
    msgsEl.innerHTML = ''
    msgs.forEach((m) => ajouterMsg(m.contenu, m.role))
  } catch {}
}

/* ---------- Messages ---------- */
function ajouterMsg(texte, role) {
  const w = $('welcome')
  if (w) w.remove()
  const row = document.createElement('div')
  row.className = 'row ' + (role === 'user' ? 'user' : 'bot')
  const av = document.createElement('div')
  av.className = 'av'
  av.innerHTML = role === 'user'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 19.5a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 20h6M12 16.5V20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  const bub = document.createElement('div')
  bub.className = 'bub'
  if (texte === '__typing__') {
    bub.classList.add('typing')
    bub.innerHTML = '<i></i><i></i><i></i>'
  } else {
    bub.textContent = texte
  }
  row.appendChild(av)
  row.appendChild(bub)
  if (role !== 'user') {
    const cp = document.createElement('button')
    cp.className = 'copy'; cp.title = 'Copier'; cp.textContent = '⧉'
    cp.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(bub.textContent)
        cp.textContent = '✓'; cp.classList.add('done')
        setTimeout(() => { cp.textContent = '⧉'; cp.classList.remove('done') }, 1400)
      } catch {}
    })
    row.appendChild(cp)
  }
  msgsEl.appendChild(row)
  msgsEl.scrollTop = msgsEl.scrollHeight
  return bub
}

async function sessionExpiree() {
  token = null
  await store.del('token')
  montrerLogin()
  loginErr.textContent = 'Session expirée, reconnecte-toi.'
}

/* ---------- Envoi + streaming SSE ---------- */
async function envoyerTexte(message) {
  if (!message || sendBtn.disabled) return
  ajouterMsg(message, 'user')
  const bub = ajouterMsg('__typing__', 'assistant')
  sendBtn.disabled = true
  try {
    const res = await fetch(API_BASE + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ message, sessionId })
    })
    setEnLigne()
    if (res.status === 401) { await sessionExpiree(); return }
    if (!res.ok || !res.body) {
      bub.classList.remove('typing'); bub.textContent = 'Une erreur est survenue. Réessaie.'; return
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = '', texte = '', premier = true
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const blocs = buf.split('\n\n')
      buf = blocs.pop()
      for (const bloc of blocs) {
        const ligne = bloc.split('\n').find((l) => l.startsWith('data: '))
        if (!ligne) continue
        let evt
        try { evt = JSON.parse(ligne.slice(6)) } catch { continue }
        if (evt.type === 'session') {
          sessionId = evt.sessionId
          store.set('sessionId', sessionId)
        } else if (evt.type === 'chunk') {
          if (premier) { bub.classList.remove('typing'); bub.innerHTML = ''; bub.textContent = ''; premier = false }
          texte += evt.text
          bub.textContent = texte
          msgsEl.scrollTop = msgsEl.scrollHeight
        } else if (evt.type === 'erreur') {
          bub.classList.remove('typing')
          bub.textContent = evt.message || 'Une erreur est survenue.'
        }
      }
    }
    if (premier && !texte) { bub.classList.remove('typing'); bub.textContent = 'Réponse vide. Réessaie.' }
  } catch {
    bub.classList.remove('typing'); bub.textContent = 'Connexion au service impossible.'
    setHorsLigne()
  } finally {
    sendBtn.disabled = false
    inputEl.focus()
  }
}

function envoyer() {
  const m = inputEl.value.trim()
  if (!m) return
  inputEl.value = ''
  inputEl.style.height = 'auto'
  envoyerTexte(m)
}

/* ---------- Suggestions + analyse matériel (délégation) ---------- */
msgsEl.addEventListener('click', (e) => {
  const sug = e.target.closest('.sug')
  if (sug) { envoyerTexte(sug.dataset.q); return }
  if (e.target.closest('#btn-analyse')) analyserMateriel()
})

function analyserMateriel() {
  chrome.runtime.sendMessage({ type: 'PCHELPER_HW' }, (rep) => {
    const d = (!chrome.runtime.lastError && rep && rep.ok) ? rep.data : null
    let cfg
    if (d && d.cpu) {
      cfg = `- Processeur : ${d.cpu.modele || 'CPU'} — ${d.cpu.coeurs} cœurs (charge ${d.cpu.charge}%)
- Mémoire : ${d.memoire ? d.memoire.utiliseGo + '/' + d.memoire.totalGo + ' Go' : 'inconnue'}
- Écran : ${d.ecran || 'inconnu'}`
    } else {
      cfg = `- Processeur : ${navigator.hardwareConcurrency || '?'} cœurs logiques
- Mémoire : ${navigator.deviceMemory ? '≈ ' + navigator.deviceMemory + ' Go' : 'inconnue'}`
    }
    envoyerTexte(`Voici la configuration réelle de ma machine :
${cfg}
- Navigateur / OS : ${navigator.userAgent}

Analyse cette configuration : est-elle équilibrée ? Points faibles, recommandations (drivers, mises à niveau), problèmes de compatibilité connus ?`)
  })
}

sendBtn.addEventListener('click', envoyer)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyer() }
})
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + 'px'
})

/* ---------- Démarrage ---------- */
;(async function init() {
  token = await store.get('token')
  sessionId = await store.get('sessionId')
  if (token) montrerChat()
  else montrerLogin()
})()
