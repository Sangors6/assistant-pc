/**
 * verifier-email.js — Diagnostic SMTP (reset mot de passe).
 *
 * Ne contient aucun secret : lit tout depuis .env / l'environnement.
 * N'affiche jamais le mot de passe.
 *
 * Usage :
 *   node verifier-email.js                 -> vérifie la connexion SMTP
 *   node verifier-email.js test@exemple.fr -> + envoie un email de test
 */
require('dotenv').config({ path: '.env' })
const mailer = require('./email')

const REQUISES = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM']

;(async () => {
  const manquantes = REQUISES.filter((k) => !process.env[k])
  if (manquantes.length) {
    console.error('✗ Variables manquantes :', manquantes.join(', '))
    console.error('  Renseigne-les dans .env (et sur Render), puis relance.')
    process.exit(1)
  }

  // Affiche la config SANS le mot de passe.
  console.log('Configuration détectée :')
  console.log('  EMAIL_HOST =', process.env.EMAIL_HOST)
  console.log('  EMAIL_PORT =', process.env.EMAIL_PORT)
  console.log('  EMAIL_USER =', process.env.EMAIL_USER)
  console.log('  EMAIL_PASS = (présent, masqué)')
  console.log('  EMAIL_FROM =', process.env.EMAIL_FROM)
  console.log('')

  try {
    process.stdout.write('Test de connexion SMTP... ')
    await mailer.verifier()
    console.log('✓ OK — identifiants valides, serveur joignable.')
  } catch (e) {
    console.error('✗ ÉCHEC :', e.message)
    process.exit(1)
  }

  const dest = process.argv[2]
  if (dest) {
    try {
      process.stdout.write(`Envoi d'un email de test à ${dest}...\n`)
      const info = await mailer.envoyerEmailReset(dest, 'https://assistant-pc.onrender.com/reset.html?token=TEST-DIAGNOSTIC')
      // Vérité SMTP brute renvoyée par Brevo : c'est ça qui tranche.
      console.log('  accepted  :', JSON.stringify(info && info.accepted))
      console.log('  rejected  :', JSON.stringify(info && info.rejected))
      console.log('  response  :', info && info.response)
      console.log('  messageId :', info && info.messageId)
      console.log('  envelope  :', JSON.stringify(info && info.envelope))
      if (info && info.accepted && info.accepted.length) {
        console.log('\n✓ Brevo a ACCEPTÉ le message. S\'il n\'arrive pas : filtrage côté Gmail (voir diagnostic).')
      } else {
        console.log('\n✗ Brevo n\'a PAS accepté ce destinataire — voir "rejected"/"response" ci-dessus.')
      }
    } catch (e) {
      console.error('✗ ÉCHEC envoi :', e.message)
      process.exit(1)
    }
  } else {
    console.log('\nAstuce : `node verifier-email.js ton@email.com` pour recevoir un vrai email de test.')
  }
  process.exit(0)
})()
