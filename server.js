const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')

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

let historique = []

app.get('/test', async (req, res) => {
  const reponse = await claude.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Dis juste : je fonctionne !' }]
  })
  res.send(reponse.content[0].text)
})

app.post('/chat', async (req, res) => {
  console.log('Message reçu :', req.body)
  const messageUtilisateur = req.body.message

  try {
    historique.push({ role: 'user', content: messageUtilisateur })

    const reponse = await claude.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: historique
    })

    const texteReponse = reponse.content[0].text
    console.log('Réponse Claude :', texteReponse)

    historique.push({ role: 'assistant', content: texteReponse })
    res.json({ reponse: texteReponse })

  } catch (erreur) {
    console.log('Erreur :', erreur.message)
    res.status(500).json({ erreur: erreur.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`)
})