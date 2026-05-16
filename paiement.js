// Intégration Stripe — INERTE par défaut.
//
// Tant que STRIPE_SECRET_KEY est absente, estConfigure() renvoie false et
// aucune route paiement n'est active (réponse 503 propre, jamais de crash).
// Brancher les clés Stripe TEST (dashboard hébergeur) suffit à l'activer.
// La clé webhook (STRIPE_WEBHOOK_SECRET) est requise pour vérifier la
// signature des événements — non négociable (règle absolue).
const Stripe = require('stripe')

const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, APP_URL } = process.env

function estConfigure() {
  return Boolean(STRIPE_SECRET_KEY)
}

let stripe = null
function getStripe() {
  if (!estConfigure()) return null
  if (stripe) return stripe
  stripe = new Stripe(STRIPE_SECRET_KEY.trim())
  return stripe
}

// URL de base pour les redirections de retour Stripe. APP_URL en prod
// (ex. https://assistant-pc.onrender.com), sinon déduit de la requête.
function baseUrl(req) {
  if (APP_URL) return APP_URL.replace(/\/+$/, '')
  return `${req.protocol}://${req.get('host')}`
}

// Crée une session Stripe Checkout pour l'utilisateur authentifié.
async function creerSession(req, utilisateur) {
  const s = getStripe()
  if (!s) throw new Error('stripe_non_configure')
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: String(utilisateur.id),
    customer_email: utilisateur.email,
    success_url: `${baseUrl(req)}/paiement/succes?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl(req)}/paiement/annulation`
  })
  return session.url
}

// Vérifie la signature de l'événement webhook puis le décode.
// rawBody DOIT être le corps brut (Buffer), pas le JSON parsé.
function construireEvenement(rawBody, signature) {
  const s = getStripe()
  if (!s) throw new Error('stripe_non_configure')
  if (!STRIPE_WEBHOOK_SECRET) throw new Error('webhook_secret_manquant')
  return s.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)
}

module.exports = { estConfigure, getStripe, creerSession, construireEvenement, baseUrl }
