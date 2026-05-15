/* PC Helper — logique du panneau d'extension.
 * Page d'extension : host_permissions autorise les appels API cross-origin
 * (pas de CORS). Le JWT vit dans chrome.storage.local.
 */
const API_BASE = 'https://assistant-pc.onrender.com'

/* ---------- chrome.storage.local en promesses ---------- */
const store = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
  set: (k, val) => new Promise((r) => chrome.storage.local.set({ [k]: val }, r)),
  del: (k) => new Promise((r) => chrome.storage.local.remove(k, r))
}

/* ---------- Éléments ---------- */
const $ = (id) => document.getElementById(id)
const loginForm = $('login')
const chatView = $('chat')
const msgsEl = $('msgs')
const inputEl = $('input')
const sendBtn = $('send')
const loginErr = $('login-err')
const loginBtn = $('login-btn')
const logoutBtn = $('btn-logout')

let token = null
let sessionId = null

/* ---------- Fermeture (demande au content script parent) ---------- */
$('btn-close').addEventListener('click', () => {
  parent.postMessage({ __pchelper: 'closePanel' }, '*')
})

/* ---------- Bascule connexion / chat ---------- */
function montrerLogin() {
  loginForm.style.display = 'flex'
  chatView.style.display = 'none'
  logoutBtn.style.display = 'none'
}
function montrerChat() {
  loginForm.style.display = 'none'
  chatView.style.display = 'flex'
  logoutBtn.style.display = 'block'
  chargerMateriel()
}

/* ---------- Matériel réel (via le service worker) ---------- */
function chargerMateriel() {
  const hw = $('hw')
  chrome.runtime.sendMessage({ type: 'PCHELPER_HW' }, (rep) => {
    if (!rep || !rep.ok || !rep.data) { hw.style.display = 'none'; return }
    const d = rep.data
    const chips = []
    if (d.cpu) {
      chips.push(`<span class="chip">CPU <b>${d.cpu.charge}%</b></span>`)
      chips.push(`<span class="chip">${d.cpu.coeurs} <b>cœurs</b></span>`)
    }
    if (d.memoire) {
      chips.push(`<span class="chip">RAM <b>${d.memoire.utiliseGo}/${d.memoire.totalGo} Go</b></span>`)
    }
    if (d.ecran) chips.push(`<span class="chip">Écran <b>${d.ecran}</b></span>`)
    if (!chips.length) { hw.style.display = 'none'; return }
    hw.innerHTML = chips.join('')
    hw.style.display = 'flex'
  })
}

/* ---------- Connexion ---------- */
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
    if (!res.ok) {
      loginErr.textContent = data.erreur || 'Connexion impossible.'
      return
    }
    token = data.token
    await store.set('token', token)
    await store.set('email', data.email || '')
    montrerChat()
  } catch {
    loginErr.textContent = 'Réseau indisponible. Réessaie.'
  } finally {
    loginBtn.disabled = false
    loginBtn.textContent = 'Se connecter'
  }
})

/* ---------- Déconnexion ---------- */
logoutBtn.addEventListener('click', async () => {
  try {
    await fetch(API_BASE + '/auth/deconnexion', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    })
  } catch {}
  token = null
  sessionId = null
  await store.del('token')
  await store.del('sessionId')
  msgsEl.querySelectorAll('.row').forEach((r) => r.remove())
  montrerLogin()
})

/* ---------- Affichage des messages ---------- */
function ajouterMsg(texte, role) {
  const w = $('welcome')
  if (w) w.remove()
  const row = document.createElement('div')
  row.className = 'row ' + (role === 'user' ? 'user' : 'bot')
  const av = document.createElement('div')
  av.className = 'av'
  av.textContent = role === 'user' ? '🙂' : '🖥️'
  const bub = document.createElement('div')
  bub.className = 'bub'
  if (texte === '__typing__') { bub.classList.add('typing'); bub.textContent = 'PC Helper écrit…' }
  else bub.textContent = texte
  row.appendChild(av)
  row.appendChild(bub)
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
async function envoyer() {
  const message = inputEl.value.trim()
  if (!message || sendBtn.disabled) return
  inputEl.value = ''
  inputEl.style.height = 'auto'
  ajouterMsg(message, 'user')
  const bub = ajouterMsg('__typing__', 'assistant')
  sendBtn.disabled = true

  try {
    const res = await fetch(API_BASE + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ message, sessionId })
    })

    if (res.status === 401) { await sessionExpiree(); return }
    if (!res.ok || !res.body) {
      bub.classList.remove('typing')
      bub.textContent = 'Une erreur est survenue. Réessaie.'
      return
    }

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let texte = ''
    let premier = true

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
          if (premier) { bub.classList.remove('typing'); bub.textContent = ''; premier = false }
          texte += evt.text
          bub.textContent = texte
          msgsEl.scrollTop = msgsEl.scrollHeight
        } else if (evt.type === 'erreur') {
          bub.classList.remove('typing')
          bub.textContent = evt.message || 'Une erreur est survenue.'
        }
      }
    }
    if (premier && !texte) {
      bub.classList.remove('typing')
      bub.textContent = 'Réponse vide. Réessaie.'
    }
  } catch {
    bub.classList.remove('typing')
    bub.textContent = 'Connexion au service impossible.'
  } finally {
    sendBtn.disabled = false
    inputEl.focus()
  }
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
