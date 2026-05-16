// Envoi d'emails transactionnels (réinitialisation de mot de passe).
//
// Conçu pour être INERTE tant que le SMTP n'est pas configuré : si les
// variables EMAIL_* sont absentes, estConfigure() renvoie false et
// envoyerEmailReset() ne tente rien (pas d'erreur, pas de crash au boot).
// Brancher un compte Brevo (gratuit 300 mails/jour) suffit à l'activer.
const nodemailer = require('nodemailer')

const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM } = process.env

function estConfigure() {
  return Boolean(EMAIL_HOST && EMAIL_PORT && EMAIL_USER && EMAIL_PASS && EMAIL_FROM)
}

let transport = null
function getTransport() {
  if (!estConfigure()) return null
  if (transport) return transport
  transport = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT),
    // 465 = TLS implicite ; 587/2525 = STARTTLS.
    secure: Number(EMAIL_PORT) === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  })
  return transport
}

// Échappe le strict nécessaire pour une insertion sûre dans le HTML de l'email.
function echapperHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function gabaritReset(lienReset) {
  const lien = echapperHtml(lienReset)
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#070b14;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e6edf7">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#070b14;padding:40px 0">
    <tr><td align="center">
      <table role="presentation" width="460" cellpadding="0" cellspacing="0" style="background:#0c1322;border:1px solid #1c2638;border-radius:16px;overflow:hidden">
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:18px;font-weight:700;color:#fff">PC Helper</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0">
          <h1 style="font-size:19px;margin:12px 0 6px;color:#fff">Réinitialisation du mot de passe</h1>
          <p style="font-size:14px;line-height:1.6;color:#9fb0c9;margin:0 0 22px">
            Tu as demandé à réinitialiser ton mot de passe. Clique sur le bouton
            ci-dessous. Ce lien expire dans <strong>1 heure</strong>.
          </p>
          <a href="${lien}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:10px">Réinitialiser mon mot de passe</a>
          <p style="font-size:12px;line-height:1.6;color:#6b7c99;margin:24px 0 0">
            Si tu n'es pas à l'origine de cette demande, ignore cet email :
            ton mot de passe reste inchangé.
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px 28px">
          <div style="border-top:1px solid #1c2638;padding-top:16px;font-size:11px;color:#56657f">
            PC Helper — email automatique, ne pas répondre.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`
}

async function envoyerEmailReset(destinataire, lienReset) {
  const t = getTransport()
  if (!t) return false // SMTP non configuré : on n'échoue pas, on n'envoie pas.
  await t.sendMail({
    from: EMAIL_FROM,
    to: destinataire,
    subject: 'Réinitialisation de ton mot de passe — PC Helper',
    html: gabaritReset(lienReset)
  })
  return true
}

// Vérifie que les identifiants SMTP sont valides (handshake réel, aucun
// email envoyé). Lève si la configuration est absente ou incorrecte.
async function verifier() {
  const t = getTransport()
  if (!t) throw new Error('SMTP non configuré (variables EMAIL_* manquantes)')
  await t.verify()
  return true
}

module.exports = { estConfigure, envoyerEmailReset, verifier }
