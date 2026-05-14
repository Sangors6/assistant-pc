const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('./database')

const app = express()
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const JWT_SECRET = process.env.JWT_SECRET || 'secret_dev_change_en_prod'
const LIMITE_GRATUIT = 10

app.use(express.json())
app.use(express.static('.'))

const SYSTEM_PROMPT = `Tu es un expert en support informatique spécialisé dans :
- Le diagnostic et dépannage PC Windows
- Les problèmes réseau (Wi-Fi, connexion, DNS)
- L'optimisation pour le gaming (FPS, latence, drivers)
- Les erreurs système courantes

Ton style :
- Clair et simple, tu évites le jargon inutile
- Tu poses des questions pour cerner le problème avant de donner une solution
- Tu donnes des étapes numérotées et concrètes
- Si tu ne sais pas, tu le dis honnêtement`

const sessions = {}

// Middleware : vérifie le token JWT
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

// Inscription
app.post('/auth/inscription', async (req, res) => {
  const { email, motDePasse } = req.body
  if (!email || !motDePasse) return res.status(400).json({ erreur: 'Email et mot de passe requis' })

  try {
    const hash = await bcrypt.hash(motDePasse, 10)
    db.prepare('INSERT INTO utilisateurs (email, mot_de_passe) VALUES (?, ?)').run(email, hash)
    res.json({ message: 'Compte créé avec succès' })
  } catch {
    res.status(400).json({ erreur: 'Cet email est déjà utilisé' })
  }
})

// Connexion
app.post('/auth/connexion', async (req, res) => {
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

// Infos utilisateur connecté
app.get('/auth/moi', authentifier, (req, res) => {
  const utilisateur = db.prepare('SELECT id, email, plan, messages_utilises FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)
  res.json(utilisateur)
})

// Chat
app.post('/chat', authentifier, async (req, res) => {
  const { message, sessionId } = req.body
  const utilisateur = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)

  // Vérifie la limite du plan gratuit
  if (utilisateur.plan === 'gratuit' && utilisateur.messages_utilises >= LIMITE_GRATUIT) {
    return res.status(403).json({ erreur: 'limite_atteinte' })
  }

  if (!sessionId || !sessions[sessionId]) {
    const nouvelId = crypto.randomUUID()
    sessions[nouvelId] = { historique: [], dernierAcces: Date.now() }
  }

  const id = sessionId && sessions[sessionId] ? sessionId : Object.keys(sessions).at(-1)
  sessions[id].dernierAcces = Date.now()

  try {
    sessions[id].historique.push({ role: 'user', content: message })

    const reponse = await claude.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: sessions[id].historique
    })

    const texteReponse = reponse.content[0].text
    sessions[id].historique.push({ role: 'assistant', content: texteReponse })

    // Incrémente le compteur de messages
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