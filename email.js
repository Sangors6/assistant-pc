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

// Gabarit volontairement robuste : attributs `bgcolor` (conservés même quand
// le client retire le CSS, ex. Gmail), fond clair par défaut + carte foncée,
// texte toujours suffisamment contrasté sur SON propre fond — il ne dépend
// jamais du fond du <body> (cause classique d'un email "vide").
function gabaritReset(lienReset) {
  const lien = echapperHtml(lienReset)
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0b1220;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b1220" style="background-color:#0b1220;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="460" cellpadding="0" cellspacing="0" border="0" bgcolor="#111c30" style="background-color:#111c30;border:1px solid #25334c;border-radius:16px;max-width:460px;width:100%;">
        <tr><td style="padding:30px 34px 6px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">PC&nbsp;Helper</td></tr>
        <tr><td style="padding:6px 34px 0;font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:19px;font-weight:bold;color:#ffffff;margin:12px 0 8px;">Réinitialisation du mot de passe</div>
          <div style="font-size:14px;line-height:1.6;color:#c3cee0;margin:0 0 22px;">
            Tu as demandé à réinitialiser ton mot de passe. Clique sur le bouton ci-dessous. Ce lien expire dans <strong style="color:#ffffff;">1&nbsp;heure</strong>.
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="#2563eb" style="border-radius:10px;">
              <a href="${lien}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:10px;">Réinitialiser mon mot de passe</a>
            </td>
          </tr></table>
          <div style="font-size:13px;line-height:1.6;color:#9fb0c9;margin:22px 0 0;">
            Ou copie ce lien dans ton navigateur&nbsp;:
          </div>
          <!-- URL en TEXTE BRUT, jamais dans une balise <a> : Brevo réécrit
               les href (tracking de clic) mais ne touche pas au texte. Ainsi
               l'utilisateur copie le vrai lien, sans pistage ni token altéré. -->
          <div style="font-size:13px;line-height:1.6;color:#ffffff;margin:8px 0 0;word-break:break-all;font-family:Consolas,Menlo,Monaco,monospace;background-color:#0b1220;border:1px solid #25334c;border-radius:8px;padding:12px 14px;">${lien}</div>
          <div style="font-size:12px;line-height:1.6;color:#8294b0;margin:22px 0 0;">
            Si tu n'es pas à l'origine de cette demande, ignore cet email&nbsp;: ton mot de passe reste inchangé.
          </div>
        </td></tr>
        <tr><td style="padding:22px 34px 30px;font-family:Arial,Helvetica,sans-serif;">
          <div style="border-top:1px solid #25334c;padding-top:16px;font-size:11px;color:#6b7c99;">PC Helper — email automatique, ne pas répondre.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

// Alternative texte (toujours lisible, et meilleure délivrabilité anti-spam).
function gabaritResetTexte(lienReset) {
  return [
    'PC Helper — Réinitialisation du mot de passe',
    '',
    'Tu as demandé à réinitialiser ton mot de passe.',
    'Ouvre ce lien (valable 1 heure) :',
    '',
    lienReset,
    '',
    "Si tu n'es pas à l'origine de cette demande, ignore cet email :",
    'ton mot de passe reste inchangé.'
  ].join('\n')
}

async function envoyerEmailReset(destinataire, lienReset) {
  const t = getTransport()
  if (!t) return false // SMTP non configuré : on n'échoue pas, on n'envoie pas.
  await t.sendMail({
    from: EMAIL_FROM,
    to: destinataire,
    subject: 'Réinitialisation de ton mot de passe — PC Helper',
    text: gabaritResetTexte(lienReset),
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
