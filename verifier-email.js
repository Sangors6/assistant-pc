/**
 * verifier-email.js — Diagnostic email (reset mot de passe).
 *
 * Ne contient aucun secret : lit tout depuis .env / l'environnement.
 * N'affiche jamais les identifiants.
 *
 * Usage :
 *   node verifier-email.js                 -> vérifie la config (API ou SMTP)
 *   node verifier-email.js test@exemple.fr -> + envoie un VRAI email de reset
 *
 * L'email envoyé contient un lien de réinitialisation RÉEL et fonctionnel
 * (token UUID inséré en base, valable 1 h), exactement comme la route
 * /auth/reset-demande — à condition qu'un compte existe pour cette adresse.
 */
require('dotenv').config({ path: '.env' })
const crypto = require('crypto')
const mailer = require('./email')
const { one, run, pool } = require('./database')

const normaliserEmail = (e) => String(e).trim().toLowerCase()
const hacherToken = (t) => crypto.createHash('sha256').update(t).digest('hex')
const baseUrl = () =>
  (process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '') : 'https://assistant-pc.onrender.com')

;(async () => {
  if (!mailer.estConfigure()) {
    console.error('✗ Email non configuré (ni BREVO_API_KEY ni SMTP EMAIL_*).')
    process.exit(1)
  }

  console.log('Configuration détectée :')
  console.log('  mode       =', mailer.mode(), '(api = HTTP Brevo, smtp = nodemailer)')
  console.log('  EMAIL_FROM =', process.env.EMAIL_FROM)
  console.log('  APP_URL    =', process.env.APP_URL || '(non défini -> ' + baseUrl() + ')')
  console.log('')

  try {
    process.stdout.write(`Vérification config email (mode ${mailer.mode()})... `)
    await mailer.verifier()
    console.log('✓ OK — identifiants valides, service joignable.')
  } catch (e) {
    console.error('✗ ÉCHEC :', e.message)
    await pool.end().catch(() => {})
    process.exit(1)
  }

  const dest = process.argv[2]
  if (!dest) {
    console.log('\nAstuce : `node verifier-email.js ton@email.com` pour un vrai email de reset.')
    await pool.end().catch(() => {})
    process.exit(0)
  }

  try {
    const emailN = normaliserEmail(dest)
    const u = await one('SELECT id FROM utilisateurs WHERE email = $1', [emailN])
    if (!u) {
      console.error(`✗ Aucun compte pour "${emailN}" : impossible de générer un lien de`)
      console.error('  réinitialisation valide. Crée d\'abord le compte (inscription).')
      await pool.end().catch(() => {})
      process.exit(1)
    }

    // VRAI token, même logique que /auth/reset-demande (UUID, haché, TTL 1 h).
    const tokenClair = crypto.randomUUID()
    const expire = new Date(Date.now() + 60 * 60 * 1000)
    await run(
      'INSERT INTO password_resets (utilisateur_id, token, expire_le) VALUES ($1, $2, $3)',
      [u.id, hacherToken(tokenClair), expire]
    )
    const lien = `${baseUrl()}/reset.html?token=${tokenClair}`

    process.stdout.write(`Envoi d'un email de reset RÉEL à ${emailN}...\n`)
    const info = await mailer.envoyerEmailReset(emailN, lien)
    console.log('  accepted  :', JSON.stringify(info && info.accepted))
    console.log('  rejected  :', JSON.stringify(info && info.rejected))
    console.log('  messageId :', info && info.messageId)
    console.log('  lien      :', lien)
    if (info && info.accepted && info.accepted.length) {
      console.log('\n✓ Email accepté par Brevo. Le lien est RÉEL et valable 1 h.')
    } else {
      console.log('\n✗ Non accepté — voir "rejected" ci-dessus.')
    }
  } catch (e) {
    console.error('✗ ÉCHEC :', e.message)
    await pool.end().catch(() => {})
    process.exit(1)
  }

  await pool.end().catch(() => {})
  process.exit(0)
})()
