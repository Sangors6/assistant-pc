require('dotenv').config({ path: 'key.env' })
const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('./database')

const app = express()
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const JWT_SECRET = process.env.JWT_SECRET || 'secret_dev_change_en_prod'
const LIMITE_GRATUIT = 999999

app.use(express.json())
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

Ton identité :
- Tu t'appelles PC Helper
- Tu es un assistant IA propriétaire développé pour PC Helper
- Ne mentionne jamais Claude, Anthropic, GPT, OpenAI ou tout autre modèle IA
- Si on te pose des questions sur nous, réponds poliment que tu es simplement un assistant IA`

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

app.get('/auth/moi', authentifier, (req, res) => {
  const utilisateur = db.prepare('SELECT id, email, plan, messages_utilises FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)
  res.json(utilisateur)
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
    console.log('Erreur suppression :', erreur.message)
    res.status(500).json({ erreur: erreur.message })
  }
})

app.post('/chat', authentifier, async (req, res) => {
  const { message, sessionId } = req.body
  const utilisateur = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(req.utilisateur.id)

  if (utilisateur.plan === 'gratuit' && utilisateur.messages_utilises >= LIMITE_GRATUIT) {
    return res.status(403).json({ erreur: 'limite_atteinte' })
  }

  const id = sessionId || crypto.randomUUID()

  const historique = db.prepare(
    'SELECT role, contenu as content FROM conversations WHERE utilisateur_id = ? AND session_id = ? ORDER BY cree_le ASC'
  ).all(utilisateur.id, id)

  historique.push({ role: 'user', content: message })

  db.prepare('INSERT INTO conversations (utilisateur_id, session_id, role, contenu) VALUES (?, ?, ?, ?)')
    .run(utilisateur.id, id, 'user', message)

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