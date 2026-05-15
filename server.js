require('dotenv').config({ path: '.env' })
const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('./database')

const si = require('systeminformation')

app.get('/stats', authentifier, async (req, res) => {
  try {
    const [cpu, mem, graphics, networkStats] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics(),
      si.networkStats()
    ])

    res.json({
      cpu: Math.round(cpu.currentLoad),
      ram: Math.round((mem.used / mem.total) * 100),
      gpu: graphics.controllers[0]?.utilizationGpu || 0,
      ping: networkStats[0]?.ms || 0
    })
  } catch {
    res.status(500).json({ erreur: 'Impossible de lire les stats' })
  }
})

const rateLimit = require('express-rate-limit')

const limiteurAuth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives max
  message: { erreur: 'Trop de tentatives. Réessaie dans 15 minutes.' }
})

const limiteurChat = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages par minute
  message: { erreur: 'Trop de messages. Attends un moment.' }
})

const app = express()
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const JWT_SECRET = process.env.JWT_SECRET
const LIMITE_GRATUIT = 999999

app.use(express.json({ limit: '10mb' }))
app.use(express.static('.'))

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

function authentifier(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1]
  if (!token) return res.status(401).json({ erreur: 'Non connecté' })
  try {
    req.utilisateur = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ erreur: 'Session expirée' })
  }
}

app.post('/auth/inscription', limiteurAuth, async (req, res) => {
  const { email, motDePasse } = req.body

  // Validation email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ erreur: 'Email invalide' })
  }

  // Validation mot de passe
  if (!motDePasse || motDePasse.length < 8) {
    return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 8 caractères)' })
  }

  try {
    const hash = await bcrypt.hash(motDePasse, 10)
    db.prepare('INSERT INTO utilisateurs (email, mot_de_passe) VALUES (?, ?)').run(email, hash)
    res.json({ message: 'Compte créé avec succès' })
  } catch {
    res.status(400).json({ erreur: 'Cet email est déjà utilisé' })
  }
})

app.post('/auth/connexion', limiteurAuth, async (req, res) => {
  const { email, motDePasse } = req.body
  const utilisateur = db.prepare('SELECT * FROM utilisateurs WHERE email = ?').get(email)
  if (!utilisateur) return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' })
  const valide = await bcrypt.compare(motDePasse, utilisateur.mot_de_passe)
  if (!valide) return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' })
  const token = jwt.sign(
    { id: utilisateur.id, email: utilisateur.email, plan: utilisateur.plan },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.json({ token, email: utilisateur.email, plan: utilisateur.plan })
})

app.get('/auth/moi', authentifier, (req, res) => {
  const utilisateur = db.prepare('SELECT id, email, plan, messages_utilises FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)
  res.json(utilisateur)
})

// Profil — statistiques
app.get('/profil', authentifier, (req, res) => {
  const utilisateur = db.prepare('SELECT id, email, plan, messages_utilises, cree_le FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)

  const nbConversations = db.prepare(
    'SELECT COUNT(DISTINCT session_id) as total FROM conversations WHERE utilisateur_id = ?'
  ).get(req.utilisateur.id)

  const nbMessages = db.prepare(
    'SELECT COUNT(*) as total FROM conversations WHERE utilisateur_id = ? AND role = ?'
  ).get(req.utilisateur.id, 'user')

  const derniereActivite = db.prepare(
    'SELECT MAX(cree_le) as derniere FROM conversations WHERE utilisateur_id = ?'
  ).get(req.utilisateur.id)

  res.json({
    email: utilisateur.email,
    plan: utilisateur.plan,
    cree_le: utilisateur.cree_le,
    nb_conversations: nbConversations.total,
    nb_messages: nbMessages.total,
    derniere_activite: derniereActivite.derniere
  })
})

// Profil — changer mot de passe
app.post('/profil/mot-de-passe', authentifier, async (req, res) => {
  const { ancienMdp, nouveauMdp } = req.body
  if (!ancienMdp || !nouveauMdp) return res.status(400).json({ erreur: 'Champs requis' })
  if (nouveauMdp.length < 6) return res.status(400).json({ erreur: 'Mot de passe trop court (min. 6 caractères)' })

  const utilisateur = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)
  const valide = await bcrypt.compare(ancienMdp, utilisateur.mot_de_passe)
  if (!valide) return res.status(401).json({ erreur: 'Ancien mot de passe incorrect' })

  const hash = await bcrypt.hash(nouveauMdp, 10)
  db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(hash, req.utilisateur.id)
  res.json({ message: 'Mot de passe modifié avec succès' })
})

app.get('/historique/:sessionId', authentifier, (req, res) => {
  const messages = db.prepare(
    'SELECT role, contenu FROM conversations WHERE utilisateur_id = ? AND session_id = ? ORDER BY cree_le ASC'
  ).all(req.utilisateur.id, req.params.sessionId)
  res.json(messages)
})

app.get('/sessions', authentifier, (req, res) => {
  const sessions = db.prepare(`
    SELECT session_id, MIN(contenu) as premier_message, MAX(cree_le) as derniere_activite
    FROM conversations
    WHERE utilisateur_id = ? AND role = 'user'
    GROUP BY session_id
    ORDER BY derniere_activite DESC
    LIMIT 20
  `).all(req.utilisateur.id)
  res.json(sessions)
})

app.delete('/sessions/:sessionId', authentifier, (req, res) => {
  try {
    db.prepare('DELETE FROM conversations WHERE utilisateur_id = ? AND session_id = ?')
      .run(req.utilisateur.id, req.params.sessionId)
    res.status(200).json({ message: 'Conversation supprimée' })
  } catch (erreur) {
    res.status(500).json({ erreur: erreur.message })
  }
})

app.post('/chat', limiteurChat, authentifier, async (req, res) => {
  const { message, sessionId, image } = req.body
  const utilisateur = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)

  if (utilisateur.plan === 'gratuit' && utilisateur.messages_utilises >= LIMITE_GRATUIT) {
    return res.status(403).json({ erreur: 'limite_atteinte' })
  }

  const id = sessionId || crypto.randomUUID()

  const historique = db.prepare(
    'SELECT role, contenu as content FROM conversations WHERE utilisateur_id = ? AND session_id = ? ORDER BY cree_le ASC'
  ).all(utilisateur.id, id)

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
  db.prepare('INSERT INTO conversations (utilisateur_id, session_id, role, contenu) VALUES (?, ?, ?, ?)')
    .run(utilisateur.id, id, 'user', texteAffiche)

  try {
    const reponse = await claude.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: historique
    })

    const texteReponse = reponse.content[0].text
    db.prepare('INSERT INTO conversations (utilisateur_id, session_id, role, contenu) VALUES (?, ?, ?, ?)')
      .run(utilisateur.id, id, 'assistant', texteReponse)
    db.prepare('UPDATE utilisateurs SET messages_utilises = messages_utilises + 1 WHERE id = ?').run(utilisateur.id)

    res.json({ reponse: texteReponse, sessionId: id, messagesUtilises: utilisateur.messages_utilises + 1 })

  } catch (erreur) {
    console.log('Erreur :', erreur.message)
    res.status(500).json({ erreur: erreur.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`)
})