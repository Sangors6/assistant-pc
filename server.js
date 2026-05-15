require('dotenv').config({ path: '.env' })
const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const si = require('systeminformation')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { query, one, run, initDb } = require('./database')

const rateLimit = require('express-rate-limit')

const limiteurAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erreur: 'Trop de tentatives. Réessaie dans 15 minutes.' }
})

const limiteurChat = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { erreur: 'Trop de messages. Attends un moment.' }
})

const limiteurStats = rateLimit({
  windowMs: 10 * 1000,
  max: 5,
  message: { erreur: 'Trop de requêtes.' }
})

const app = express()
app.disable('x-powered-by') // ne pas révéler la stack (Express)
// Derrière le proxy de l'hébergeur (Render/Railway/Vercel...) : indispensable
// pour que req.ip (rate-limit, verrouillage) et req.secure (HSTS) soient justes.
// '1' = on fait confiance au premier proxy uniquement. Inoffensif en local.
app.set('trust proxy', 1)
// .trim() indispensable : une clé collée dans un dashboard d'hébergeur
// embarque souvent un espace ou un retour-ligne final invisible, ce qui
// provoque un 401 « marche en local, échoue en ligne ».
const claude = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY || '').trim() })

// Normalisation d'email : SQLite est sensible à la casse, donc sans ça
// "A@x.com" et "a@x.com" créent deux comptes distincts.
const normaliserEmail = (e) => String(e).trim().toLowerCase()

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('ERREUR FATALE : JWT_SECRET manquant ou trop court (min. 32 caractères). Arrêt du serveur.')
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERREUR FATALE : ANTHROPIC_API_KEY manquante. Arrêt du serveur.')
  process.exit(1)
}
// Une clé au mauvais format ne sera détectée qu'au premier message sinon :
// on échoue tôt et clairement (visible dans les logs de l'hébergeur).
if (!/^sk-ant-/.test(process.env.ANTHROPIC_API_KEY.trim())) {
  console.error('ERREUR FATALE : ANTHROPIC_API_KEY invalide (doit commencer par "sk-ant-"). Vérifie la variable chez l\'hébergeur.')
  process.exit(1)
}

const LIMITE_GRATUIT = 999999
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Verrouillage de connexion par compte (en mémoire)
const MAX_ECHECS = 8
const DUREE_BLOCAGE = 15 * 60 * 1000
const echecsConnexion = new Map()

function estBloque(email) {
  const e = echecsConnexion.get(email)
  if (!e) return false
  if (e.count >= MAX_ECHECS && Date.now() < e.until) return true
  if (Date.now() >= e.until) echecsConnexion.delete(email)
  return false
}

function noterEchec(email) {
  const e = echecsConnexion.get(email) || { count: 0, until: 0 }
  e.count += 1
  e.until = Date.now() + DUREE_BLOCAGE
  echecsConnexion.set(email, e)
}

// Révocation de tokens (déconnexion serveur). En mémoire : purgé au
// redémarrage, ce qui est sans risque puisque les tokens expirent vite.
const TOKEN_TTL = '24h'
const jtiRevoques = new Map() // jti -> timestamp d'expiration

function revoquerJti(jti, expSec) {
  if (jti) jtiRevoques.set(jti, (expSec ? expSec * 1000 : Date.now() + 86400000))
}
function estRevoque(jti) {
  if (!jti) return false
  const exp = jtiRevoques.get(jti)
  if (exp === undefined) return false
  if (Date.now() >= exp) { jtiRevoques.delete(jti); return false }
  return true
}
// Purge périodique des jti expirés
setInterval(() => {
  const now = Date.now()
  for (const [jti, exp] of jtiRevoques) if (now >= exp) jtiRevoques.delete(jti)
}, 60 * 60 * 1000).unref()

// Politique de mot de passe + vérification Have I Been Pwned (k-anonymat)
function validerMotDePasse(mdp) {
  if (typeof mdp !== 'string' || mdp.length < 10) {
    return 'Mot de passe trop court (min. 10 caractères)'
  }
  if (mdp.length > 200) return 'Mot de passe trop long'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(mdp)).length
  if (classes < 3) {
    return 'Le mot de passe doit combiner au moins 3 types : minuscule, majuscule, chiffre, symbole'
  }
  return null
}

function motDePasseCompromis(mdp) {
  return new Promise((resolve) => {
    try {
      const sha1 = crypto.createHash('sha1').update(mdp).digest('hex').toUpperCase()
      const prefixe = sha1.slice(0, 5)
      const suffixe = sha1.slice(5)
      const req = https.get({
        hostname: 'api.pwnedpasswords.com',
        path: '/range/' + prefixe,
        headers: { 'Add-Padding': 'true', 'User-Agent': 'PC-Helper' },
        timeout: 3000
      }, (resp) => {
        let data = ''
        resp.on('data', c => data += c)
        resp.on('end', () => {
          const trouve = data.split('\n').some(l => {
            const [suf, count] = l.trim().split(':')
            return suf === suffixe && Number(count) > 0
          })
          resolve(trouve)
        })
      })
      req.on('error', () => resolve(false))   // fail-open : ne bloque pas si l'API est injoignable
      req.on('timeout', () => { req.destroy(); resolve(false) })
    } catch { resolve(false) }
  })
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ')

// En-têtes de sécurité AVANT le service des fichiers statiques,
// sinon express.static répond sans jamais passer par ce middleware.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '0')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', CSP)
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

app.use(express.json({ limit: '10mb' }))

// Service des fichiers statiques avec une politique de cache stricte.
// HTML : 'no-cache' = le navigateur DOIT revalider auprès du serveur avant
// de réutiliser sa copie (304 si inchangé, sinon nouvelle version). Sans ça,
// un déploiement peut rester invisible : le navigateur affiche l'ancienne
// page tant que son cache n'a pas expiré. Les autres assets (svg, mp3)
// changent rarement : cache court d'une heure, suffisant et sûr.
app.use(express.static('public', {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache')
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600')
    }
  }
}))

const SYSTEM_PROMPT = `Tu es un technicien informatique expérimenté intégré à PC Helper.

Ton comportement :
- Tu es direct, honnête et factuel — tu ne cherches pas à plaire
- Tu poses des questions précises pour identifier le vrai problème avant de donner une solution
- Tu donnes des solutions concrètes et testées, pas des généralités
- Si tu ne sais pas, tu le dis clairement
- Si l'utilisateur se trompe dans son diagnostic, tu le corriges poliment mais fermement
- Tu ne valides pas une mauvaise piste juste pour faire plaisir
- Tes réponses sont courtes et vont droit au but — pas de remplissage
- Tu es amical mais professionnel, pas familier
- Tu n'utilises pas d'emojis sauf exception
- Tu ne commences jamais par des formules creuses comme "Bien sûr !", "Absolument !", "Excellente question !"
- Quand on t'envoie une image, analyse-la en détail et identifie le problème visible

Ton identité :
- Tu t'appelles PC Helper
- Tu es un assistant propriétaire développé pour PC Helper
- Ne mentionne jamais Claude, Anthropic, GPT, OpenAI ou tout autre modèle IA
- Si on te pose des questions sur nous, réponds poliment que tu es simplement un assistant`

async function authentifier(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1]
  if (!token) return res.status(401).json({ erreur: 'Non connecté' })
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    if (estRevoque(decoded.jti)) return res.status(401).json({ erreur: 'Session expirée' })
    const user = await one('SELECT mdp_version FROM utilisateurs WHERE id = $1', [decoded.id])
    if (!user) return res.status(401).json({ erreur: 'Session expirée' })
    if (decoded.mdp_version !== undefined && decoded.mdp_version !== user.mdp_version) {
      return res.status(401).json({ erreur: 'Session expirée' })
    }
    req.utilisateur = decoded
    next()
  } catch {
    res.status(401).json({ erreur: 'Session expirée' })
  }
}

app.post('/auth/inscription', limiteurAuth, async (req, res) => {
  const { email, motDePasse } = req.body
  if (!email || !motDePasse) return res.status(400).json({ erreur: 'Email et mot de passe requis' })
  if (typeof email !== 'string' || typeof motDePasse !== 'string') return res.status(400).json({ erreur: 'Données invalides' })
  const emailN = normaliserEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailN)) return res.status(400).json({ erreur: 'Email invalide' })
  if (emailN.length > 254) return res.status(400).json({ erreur: 'Email invalide' })
  const erreurMdp = validerMotDePasse(motDePasse)
  if (erreurMdp) return res.status(400).json({ erreur: erreurMdp })
  if (await motDePasseCompromis(motDePasse)) {
    return res.status(400).json({ erreur: 'Ce mot de passe figure dans des fuites de données connues. Choisis-en un autre.' })
  }
  try {
    const hash = await bcrypt.hash(motDePasse, 10)
    await run('INSERT INTO utilisateurs (email, mot_de_passe) VALUES ($1, $2)', [emailN, hash])
  } catch (erreur) {
    // Réponse identique qu'un compte ait été créé ou non : pas d'énumération.
    console.error('Inscription :', erreur.message)
  }
  res.json({ message: 'Si l\'adresse est valide, le compte est créé. Tu peux te connecter.' })
})

app.post('/auth/connexion', limiteurAuth, async (req, res) => {
  const { email, motDePasse } = req.body
  if (typeof email !== 'string' || typeof motDePasse !== 'string' || !email || !motDePasse) {
    return res.status(400).json({ erreur: 'Email et mot de passe requis' })
  }
  const emailN = normaliserEmail(email)
  if (estBloque(emailN)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Réessaie dans 15 minutes.' })
  }
  const utilisateur = await one('SELECT * FROM utilisateurs WHERE email = $1', [emailN])
  if (!utilisateur) {
    await bcrypt.compare(motDePasse, DUMMY_HASH)
    noterEchec(emailN)
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' })
  }
  const valide = await bcrypt.compare(motDePasse, utilisateur.mot_de_passe)
  if (!valide) {
    noterEchec(emailN)
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' })
  }
  echecsConnexion.delete(emailN)
  const token = jwt.sign(
    { id: utilisateur.id, email: utilisateur.email, plan: utilisateur.plan, mdp_version: utilisateur.mdp_version },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL, jwtid: crypto.randomUUID(), algorithm: 'HS256' }
  )
  res.json({ token, email: utilisateur.email, plan: utilisateur.plan })
})

// Déconnexion serveur : révoque le token courant (vraie invalidation).
app.post('/auth/deconnexion', authentifier, (req, res) => {
  revoquerJti(req.utilisateur.jti, req.utilisateur.exp)
  res.json({ message: 'Déconnecté' })
})

app.get('/auth/moi', authentifier, async (req, res) => {
  const utilisateur = await one('SELECT id, email, plan, messages_utilises FROM utilisateurs WHERE id = $1', [req.utilisateur.id])
  res.json(utilisateur)
})

app.get('/profil', authentifier, async (req, res) => {
  const utilisateur = await one('SELECT id, email, plan, messages_utilises, cree_le FROM utilisateurs WHERE id = $1', [req.utilisateur.id])

  const nbConversations = await one(
    'SELECT COUNT(DISTINCT session_id) as total FROM conversations WHERE utilisateur_id = $1',
    [req.utilisateur.id]
  )

  const nbMessages = await one(
    'SELECT COUNT(*) as total FROM conversations WHERE utilisateur_id = $1 AND role = $2',
    [req.utilisateur.id, 'user']
  )

  const derniereActivite = await one(
    'SELECT MAX(cree_le) as derniere FROM conversations WHERE utilisateur_id = $1',
    [req.utilisateur.id]
  )

  res.json({
    email: utilisateur.email,
    plan: utilisateur.plan,
    cree_le: utilisateur.cree_le,
    // pg renvoie COUNT en chaîne (bigint) : on garde des nombres dans l'API.
    nb_conversations: Number(nbConversations.total),
    nb_messages: Number(nbMessages.total),
    derniere_activite: derniereActivite.derniere
  })
})

app.post('/profil/mot-de-passe', authentifier, async (req, res) => {
  const { ancienMdp, nouveauMdp } = req.body
  if (!ancienMdp || !nouveauMdp) return res.status(400).json({ erreur: 'Champs requis' })
  if (typeof ancienMdp !== 'string' || typeof nouveauMdp !== 'string') return res.status(400).json({ erreur: 'Données invalides' })
  const erreurMdp = validerMotDePasse(nouveauMdp)
  if (erreurMdp) return res.status(400).json({ erreur: erreurMdp })

  const utilisateur = await one('SELECT * FROM utilisateurs WHERE id = $1', [req.utilisateur.id])
  const valide = await bcrypt.compare(ancienMdp, utilisateur.mot_de_passe)
  if (!valide) return res.status(401).json({ erreur: 'Ancien mot de passe incorrect' })

  if (await motDePasseCompromis(nouveauMdp)) {
    return res.status(400).json({ erreur: 'Ce mot de passe figure dans des fuites de données connues. Choisis-en un autre.' })
  }

  const hash = await bcrypt.hash(nouveauMdp, 10)
  await run('UPDATE utilisateurs SET mot_de_passe = $1, mdp_version = mdp_version + 1 WHERE id = $2', [hash, req.utilisateur.id])
  res.json({ message: 'Mot de passe modifié avec succès' })
})

app.get('/peripheriques', limiteurStats, authentifier, async (req, res) => {
  try {
    const [usbs, audios] = await Promise.all([si.usb(), si.audio()])
    const categoriser = (nom) => {
      const n = (nom || '').toLowerCase()
      if (n.includes('mouse') || n.includes('souris')) return { type: 'souris', icone: '🖱️' }
      if (n.includes('keyboard') || n.includes('clavier')) return { type: 'clavier', icone: '⌨️' }
      if (n.includes('headset') || n.includes('headphone') || n.includes('casque') || n.includes('audio') || n.includes('sound') || n.includes('speaker') || n.includes('microphone') || n.includes('realtek') || n.includes('stereo') || n.includes('high definition')) return { type: 'audio', icone: '🎧' }
      if (n.includes('camera') || n.includes('webcam')) return { type: 'camera', icone: '📷' }
      if (n.includes('hub')) return { type: 'hub', icone: '🔗' }
      return { type: 'autre', icone: '🔌' }
    }
    const vus = new Set()
    const peripheriques = []
    for (const u of usbs) {
      const nom = (u.name || u.deviceName || '').trim()
      if (!nom) continue
      const cle = nom.toLowerCase()
      if (vus.has(cle)) continue
      vus.add(cle)
      const { type, icone } = categoriser(nom)
      peripheriques.push({ nom, type, icone })
    }
    for (const a of audios) {
      const nom = (a.name || '').trim()
      if (!nom) continue
      const cle = nom.toLowerCase()
      if (vus.has(cle)) continue
      vus.add(cle)
      peripheriques.push({ nom, type: 'audio', icone: '🎧' })
    }
    res.json(peripheriques)
  } catch {
    res.status(500).json({ erreur: 'Impossible de détecter les périphériques' })
  }
})

app.get('/stats', limiteurStats, authentifier, async (req, res) => {
  try {
    const [load, mem, graphics, latency, temp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics(),
      si.inetLatency(),
      si.cpuTemperature()
    ])
    res.json({
      cpu: Math.round(load.currentLoad),
      ram: Math.round((mem.used / mem.total) * 100),
      gpu: Math.round(graphics.controllers[0]?.utilizationGpu ?? 0),
      ping: Math.round(latency),
      temp: Math.round(temp.main ?? 0)
    })
  } catch {
    res.status(500).json({ erreur: 'Stats non disponibles' })
  }
})

app.get('/historique/:sessionId', authentifier, async (req, res) => {
  if (!UUID_REGEX.test(req.params.sessionId)) return res.status(400).json({ erreur: 'Session invalide' })
  const messages = await query(
    'SELECT role, contenu FROM conversations WHERE utilisateur_id = $1 AND session_id = $2 ORDER BY cree_le ASC',
    [req.utilisateur.id, req.params.sessionId]
  )
  res.json(messages)
})

app.get('/sessions', authentifier, async (req, res) => {
  const sessions = await query(`
    SELECT c.session_id,
      (SELECT c2.contenu FROM conversations c2
       WHERE c2.session_id = c.session_id AND c2.utilisateur_id = c.utilisateur_id AND c2.role = 'user'
       ORDER BY c2.cree_le ASC LIMIT 1) as premier_message,
      MAX(c.cree_le) as derniere_activite
    FROM conversations c
    WHERE c.utilisateur_id = $1 AND c.role = 'user'
    GROUP BY c.session_id
    ORDER BY derniere_activite DESC
    LIMIT 20
  `, [req.utilisateur.id])
  res.json(sessions)
})

app.delete('/sessions/:sessionId', authentifier, async (req, res) => {
  if (!UUID_REGEX.test(req.params.sessionId)) return res.status(400).json({ erreur: 'Session invalide' })
  try {
    await run('DELETE FROM conversations WHERE utilisateur_id = $1 AND session_id = $2',
      [req.utilisateur.id, req.params.sessionId])
    res.status(200).json({ message: 'Conversation supprimée' })
  } catch (erreur) {
    console.error('Suppression session :', erreur.message)
    res.status(500).json({ erreur: 'Suppression impossible' })
  }
})

app.post('/chat', limiteurChat, authentifier, async (req, res) => {
  const { message, sessionId, image } = req.body

  if (message !== undefined && message !== null && typeof message !== 'string') {
    return res.status(400).json({ erreur: 'Message invalide' })
  }
  if (message && message.length > 4000) {
    return res.status(400).json({ erreur: 'Message trop long (max. 4000 caractères)' })
  }
  if (sessionId !== undefined && sessionId !== null && !UUID_REGEX.test(sessionId)) {
    return res.status(400).json({ erreur: 'Session invalide' })
  }

  const MEDIA_AUTORISES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  if (image !== undefined && image !== null) {
    if (typeof image !== 'object' ||
        typeof image.data !== 'string' ||
        typeof image.mediaType !== 'string' ||
        !MEDIA_AUTORISES.includes(image.mediaType)) {
      return res.status(400).json({ erreur: 'Image invalide' })
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(image.data) || image.data.length > 7_000_000) {
      return res.status(400).json({ erreur: 'Image invalide ou trop volumineuse' })
    }
  }
  if (!message && !image) {
    return res.status(400).json({ erreur: 'Message vide' })
  }

  const utilisateur = await one('SELECT * FROM utilisateurs WHERE id = $1', [req.utilisateur.id])

  if (utilisateur.plan === 'gratuit' && utilisateur.messages_utilises >= LIMITE_GRATUIT) {
    return res.status(403).json({ erreur: 'limite_atteinte' })
  }

  const id = sessionId || crypto.randomUUID()

  const historique = await query(
    'SELECT role, contenu as content FROM conversations WHERE utilisateur_id = $1 AND session_id = $2 ORDER BY cree_le ASC',
    [utilisateur.id, id]
  )

  let contenuMessage
  if (image) {
    contenuMessage = [
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
      { type: 'text', text: message || 'Analyse cette capture d\'écran et dis-moi quel est le problème.' }
    ]
  } else {
    contenuMessage = message
  }

  const texteAffiche = message || '[Image envoyée]'
  historique.push({ role: 'user', content: contenuMessage })
  await run('INSERT INTO conversations (utilisateur_id, session_id, role, contenu) VALUES ($1, $2, $3, $4)',
    [utilisateur.id, id, 'user', texteAffiche])

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  res.write(`data: ${JSON.stringify({ type: 'session', sessionId: id })}\n\n`)

  // Si le client ferme l'onglet en plein streaming : on coupe l'appel à
  // l'API (économie de coût) et on n'écrit plus rien.
  const ac = new AbortController()
  let clientParti = false
  res.on('close', () => { clientParti = true; ac.abort() })

  try {
    let texteReponse = ''

    const stream = claude.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: historique
    }, { signal: ac.signal })

    for await (const event of stream) {
      if (clientParti) break
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text
        texteReponse += chunk
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`)
      }
    }

    if (clientParti) return // rien à persister, réponse incomplète

    await run('INSERT INTO conversations (utilisateur_id, session_id, role, contenu) VALUES ($1, $2, $3, $4)',
      [utilisateur.id, id, 'assistant', texteReponse])
    await run('UPDATE utilisateurs SET messages_utilises = messages_utilises + 1 WHERE id = $1', [utilisateur.id])

    res.write(`data: ${JSON.stringify({ type: 'done', messagesUtilises: utilisateur.messages_utilises + 1 })}\n\n`)
    res.end()

  } catch (erreur) {
    if (clientParti || ac.signal.aborted) return // déconnexion volontaire, pas une vraie erreur

    // Diagnostic complet côté serveur (visible dans les logs de l'hébergeur).
    // Les erreurs du SDK Anthropic exposent .status (code HTTP) et .error.
    const status = erreur?.status
    const typeApi = erreur?.error?.error?.type
    console.error(
      'Erreur chat :',
      'status=' + (status ?? 'n/a'),
      '| name=' + (erreur?.name ?? 'n/a'),
      '| type=' + (typeApi ?? 'n/a'),
      '| message=' + (erreur?.message ?? 'n/a')
    )

    // Message client adapté : on aide l'utilisateur sans fuiter de détail
    // sensible, et on distingue une vraie panne de config d'un aléa réseau.
    let messageClient = 'Une erreur est survenue. Réessaie.'
    if (status === 401) {
      messageClient = "Le service IA est mal configuré (clé API invalide). Contacte l'administrateur."
    } else if (status === 403) {
      messageClient = "Accès au service IA refusé. Contacte l'administrateur."
    } else if (status === 400 && /credit|billing/i.test(erreur?.message || '')) {
      messageClient = "Le service IA est temporairement indisponible (crédits épuisés)."
    } else if (status === 404) {
      messageClient = "Le modèle IA configuré est introuvable. Contacte l'administrateur."
    } else if (status === 429) {
      messageClient = 'Trop de demandes en ce moment. Réessaie dans un instant.'
    } else if (status >= 500 || erreur?.name === 'APIConnectionError') {
      messageClient = 'Le service IA est momentanément indisponible. Réessaie dans un instant.'
    }

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'erreur', message: messageClient })}\n\n`)
      res.end()
    }
  }
})

// Route inconnue : réponse JSON cohérente avec le reste de l'API.
app.use((req, res) => res.status(404).json({ erreur: 'Introuvable' }))

// Gestionnaire d'erreurs final : JSON malformé, body trop gros, etc.
// Doit avoir 4 arguments pour qu'Express le reconnaisse.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.status === 400) {
    return res.status(400).json({ erreur: 'Requête invalide' })
  }
  console.error('Erreur non gérée :', err.message)
  if (res.headersSent) return next(err)
  res.status(500).json({ erreur: 'Erreur serveur' })
})


const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443
const HTTP_PORT = Number(process.env.PORT) || 3000
const KEY_PATH = process.env.SSL_KEY || path.join(__dirname, 'certs', 'key.pem')
const CERT_PATH = process.env.SSL_CERT || path.join(__dirname, 'certs', 'cert.pem')

// Derrière un hébergeur (Render, Railway, Vercel...), c'est le proxy de
// l'hébergeur qui assure TLS : l'app DOIT rester en HTTP simple sur PORT.
// Si on activait notre propre HTTPS + redirection 301 ici, l'URL publique
// renverrait un 301 PERMANENT vers https://<host>:3443 (port non exposé) —
// 301 que les navigateurs mettent en cache quasi indéfiniment : le site
// serait cassé durablement, même après correctif. On neutralise donc tout
// HTTPS auto en production, quelle que soit la présence de certificats.
const DERRIERE_PROXY =
  process.env.NODE_ENV === 'production' ||
  !!process.env.RENDER ||
  !!process.env.WEBSITE_HOSTNAME

let creds = null
if (!DERRIERE_PROXY) {
  try {
    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
      creds = { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) }
    }
  } catch (e) {
    console.error('Lecture des certificats impossible :', e.message)
  }
}

// On ne démarre les serveurs qu'une fois le schéma de base prêt :
// sinon une première requête pourrait arriver avant la création des tables.
initDb().then(() => {
  if (creds) {
    https.createServer(creds, app).listen(HTTPS_PORT, () => {
      console.log(`HTTPS démarré sur https://localhost:${HTTPS_PORT}`)
    })
    // Petit serveur HTTP qui redirige tout vers HTTPS (301), chemin préservé.
    http.createServer((req, res) => {
      const hote = (req.headers.host || `localhost:${HTTP_PORT}`).split(':')[0]
      res.writeHead(301, { Location: `https://${hote}:${HTTPS_PORT}${req.url}` })
      res.end()
    }).listen(HTTP_PORT, () => {
      console.log(`HTTP (redirection -> HTTPS) sur le port ${HTTP_PORT}`)
    })
  } else {
    if (DERRIERE_PROXY) {
      console.log('Mode production : HTTP simple, TLS assuré par le proxy de l\'hébergeur.')
    } else {
      console.warn('AVERTISSEMENT : aucun certificat trouvé, démarrage en HTTP non chiffré (dev uniquement).')
    }
    app.listen(HTTP_PORT, () => {
      console.log(`Serveur démarré sur le port ${HTTP_PORT}`)
    })
  }
}).catch((e) => {
  console.error('ERREUR FATALE : initialisation de la base impossible :', e.message)
  process.exit(1)
})
