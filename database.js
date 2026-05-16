// Couche d'accès aux données — PostgreSQL (persistant, identique en local
// et en ligne). Le comportement est piloté par DATABASE_URL : pointez la
// même URL en local et chez l'hébergeur pour un site strictement identique.
const { Pool } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('ERREUR FATALE : DATABASE_URL manquante. Arrêt du serveur.')
  process.exit(1)
}

// Les bases hébergées (Neon, Render, Supabase...) imposent TLS.
// En local sur localhost, on désactive TLS.
const estLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL)

// Dette D1 : `pg`/`pg-connection-string` déprécie l'interprétation de
// `sslmode` (require/prefer/verify-ca traités comme verify-full, bientôt
// breaking). Comme on pilote déjà TLS EXPLICITEMENT via l'option `ssl`
// ci-dessous, on retire les paramètres ssl de l'URL : le comportement TLS
// est strictement identique (zéro changement fonctionnel), mais le
// warning de dépréciation disparaît et le code devient forward-compatible.
// En cas d'URL non parsable, on retombe sur l'original (jamais bloquant).
function urlSansSsl(u) {
  try {
    const url = new URL(u)
    for (const p of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey']) {
      url.searchParams.delete(p)
    }
    return url.toString()
  } catch { return u }
}

const pool = new Pool({
  connectionString: urlSansSsl(DATABASE_URL),
  ssl: estLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
})

pool.on('error', (err) => {
  // Un client idle qui tombe ne doit pas faire planter le process.
  console.error('Erreur pool PostgreSQL :', err.message)
})

// Helpers : query -> toutes les lignes ; one -> première ligne (ou undefined).
async function query(text, params) {
  const res = await pool.query(text, params)
  return res.rows
}
async function one(text, params) {
  const res = await pool.query(text, params)
  return res.rows[0]
}
async function run(text, params) {
  return pool.query(text, params)
}

// Création du schéma — idempotente. Appelée une fois au démarrage.
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      mot_de_passe TEXT NOT NULL,
      plan TEXT DEFAULT 'gratuit',
      messages_utilises INTEGER DEFAULT 0,
      mdp_version INTEGER DEFAULT 0,
      cree_le TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id BIGSERIAL PRIMARY KEY,
      utilisateur_id BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      contenu TEXT NOT NULL,
      cree_le TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  // Réinitialisation de mot de passe par email (token à usage unique, TTL court).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id BIGSERIAL PRIMARY KEY,
      utilisateur_id BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expire_le TIMESTAMPTZ NOT NULL,
      utilise BOOLEAN DEFAULT FALSE,
      cree_le TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  // Vérification d'email à l'inscription (token usage unique, TTL court).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id BIGSERIAL PRIMARY KEY,
      utilisateur_id BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expire_le TIMESTAMPTZ NOT NULL,
      utilise BOOLEAN DEFAULT FALSE,
      cree_le TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  // verifie : DEFAULT TRUE -> les comptes EXISTANTS restent connectables
  // (non-breaking). Les nouvelles inscriptions insèrent explicitement FALSE.
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS verifie BOOLEAN DEFAULT TRUE`)
  // Sécurité si une ancienne table existait sans la colonne.
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS mdp_version INTEGER DEFAULT 0`)
  // Lien vers le client Stripe (rempli lors du 1er paiement). Inerte tant que
  // Stripe n'est pas configuré — ne change rien au comportement existant.
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(utilisateur_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(utilisateur_id, session_id)`)
  // Sert exactement les requêtes chaudes : historique et chargement du
  // contexte (WHERE utilisateur_id, session_id ORDER BY cree_le). Idempotent.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_chrono ON conversations(utilisateur_id, session_id, cree_le)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_emailverif_token ON email_verifications(token)`)
}

// Sonde de vivacité pour /health : vérifie que la base répond réellement.
// Volontairement minimaliste (1 aller-retour), sans fuite d'information.
async function ping() {
  await pool.query('SELECT 1')
}

// Purge des jetons de réinitialisation devenus inutiles : expirés OU déjà
// utilisés. Idempotent, sans risque (ces lignes ne servent plus à rien),
// borne la croissance de la table. Renvoie le nombre de lignes supprimées.
async function purgerResetsObsoletes() {
  const r1 = await pool.query(
    'DELETE FROM password_resets WHERE utilise = TRUE OR expire_le < NOW()'
  )
  // Idem pour les vérifications d'email utilisées/expirées.
  const r2 = await pool.query(
    'DELETE FROM email_verifications WHERE utilise = TRUE OR expire_le < NOW()'
  )
  return (r1.rowCount || 0) + (r2.rowCount || 0)
}

module.exports = { pool, query, one, run, initDb, ping, purgerResetsObsoletes }
