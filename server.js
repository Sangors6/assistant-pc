const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const crypto = require('crypto')

const app = express()
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

// Un objet qui contient un historique par sessionId
const sessions = {}

// Nettoie les sessions inactives depuis plus de 2h
setInterval(() => {
  const maintenant = Date.now()
  for (const id in sessions) {
    if (maintenant - sessions[id].dernierAcces > 2 * 60 * 60 * 1000) {
      delete sessions[id]
    }
  }
}, 30 * 60 * 1000)

app.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body

  // Si pas de sessionId ou session inconnue, on en crée une nouvelle
  if (!sessionId || !sessions[sessionId]) {
    const nouvelId = crypto.randomUUID()
    sessions[nouvelId] = { historique: [], dernierAcces: Date.now() }
    if (!message) {
      return res.json({ sessionId: nouvelId })
    }
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

    res.json({ reponse: texteReponse, sessionId: id })

  } catch (erreur) {
    console.log('Erreur :', erreur.message)
    res.status(500).json({ erreur: erreur.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`)
})