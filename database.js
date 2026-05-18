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
  // Composants PC saisis par l'utilisateur (modale « première connexion »).
  // JSONB : liste blanche de champs courts, validée/bornée côté route AVANT
  // écriture (jamais d'instruction, simple DONNÉE de contexte). NULL = pas
  // encore renseigné. Additif, idempotent, non destructif : les comptes
  // existants restent NULL et le flux /chat /technicien ne change pas tant
  // que rien n'est saisi (la fusion matériel ne s'active que si non-NULL).
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS profil_pc JSONB`)
  // Flag onboarding PC : passe à TRUE dès que l'utilisateur a soit enregistré
  // son PC, soit choisi « plus tard » / fermé la modale. Sert à décider
  // l'ouverture de la modale de façon FIABLE et multi-appareils (pas un
  // simple localStorage). DEFAULT FALSE -> la modale s'ouvre une fois pour
  // les comptes existants comme nouveaux (comportement voulu, non bloquant).
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS pc_onboarding_vu BOOLEAN DEFAULT FALSE`)
  // Flag questionnaire « 1re connexion » : passe à TRUE dès que l'utilisateur
  // a répondu aux 4 questions de profilage (niveau informatique). Sert à
  // décider l'ouverture OBLIGATOIRE du questionnaire de façon fiable et
  // multi-appareils (source serveur, pas un localStorage isolé). Le niveau
  // calculé est stocké dans profil_pc.niveau (JSONB) et adapte le langage
  // de PC Helper. DEFAULT FALSE -> le questionnaire s'affiche une fois pour
  // les comptes existants comme nouveaux. Additif, idempotent, non destructif.
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS questionnaire_vu BOOLEAN DEFAULT FALSE`)
  // Quota gratuit JOURNALIER (décision fondateur 2026-05-18 : 20 messages/jour,
  // remis à zéro chaque jour — borne le coût IA sans bloquer définitivement).
  // msg_jour = compteur du jour ; msg_jour_date = jour (UTC) de référence du
  // compteur : si <> aujourd'hui, le compteur est considéré comme remis à 0
  // (logique atomique côté reserverQuota, cf. server.js). messages_utilises
  // reste le TOTAL cumulé (stats /profil) — sémantique inchangée. Additif,
  // idempotent, non destructif : comptes existants démarrent à 0/NULL.
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS msg_jour INTEGER DEFAULT 0`)
  await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS msg_jour_date DATE`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(utilisateur_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(utilisateur_id, session_id)`)
  // Sert exactement les requêtes chaudes : historique et chargement du
  // contexte (WHERE utilisateur_id, session_id ORDER BY cree_le). Idempotent.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_chrono ON conversations(utilisateur_id, session_id, cree_le)`)
  // Canal d'origine d'une conversation : 'chat' (assistant principal, défaut
  // historique) ou 'technicien' (onglet « Contacter un technicien »). Permet
  // de lister proprement l'historique du technicien sans le mélanger au /chat.
  // Additif, idempotent, non destructif : les lignes existantes restent
  // 'chat' (le défaut), /chat n'a aucune ligne à changer.
  await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'chat'`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conv_canal ON conversations(utilisateur_id, canal, session_id, cree_le)`)
  // Feedback léger (pouce ↑/↓) sur les réponses — boucle d'apprentissage C5.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,
      utilisateur_id BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      session_id TEXT,
      positif BOOLEAN NOT NULL,
      cree_le TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_emailverif_token ON email_verifications(token)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(utilisateur_id, cree_le)`)
  // Suivi de résolution (#008) : l'utilisateur signale un problème réglé ;
  // on le relance discrètement plus tard pour confirmer que ça tient.
  // Mesure réelle de la North Star (problèmes confirmés résolus / semaine).
  // 100 % additif, non destructif, réversible (DROP TABLE) — aucun ALTER
  // sur une table existante, ON DELETE CASCADE cohérent avec le schéma.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resolutions (
      id BIGSERIAL PRIMARY KEY,
      utilisateur_id BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      resolu BOOLEAN,
      relance_due_le TIMESTAMPTZ NOT NULL,
      confirme_le TIMESTAMPTZ,
      cree_le TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_resol_relance ON resolutions(utilisateur_id, confirme_le, relance_due_le)`)
  // Garde-fou ATOMIQUE contre la race TOCTOU sur l'anti-doublon (#008) :
  // une seule relance en attente (confirme_le IS NULL) par (user, session).
  // Index unique partiel — la base, pas l'applicatif, garantit l'unicité
  // même sous requêtes concurrentes du pool. Additif, idempotent, réversible.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_resol_pending ON resolutions(utilisateur_id, session_id) WHERE confirme_le IS NULL`)
  // Instrumentation usage interne ANONYME (#017) : analytics purement
  // AGRÉGÉE, zéro tiers, zéro donnée personnelle. STRICTEMENT par charte :
  // aucune colonne utilisateur_id / email / IP / user-agent / contenu /
  // texte libre — aucune liaison ré-identifiante. `type` = enum fermé côté
  // serveur (cf. EVENEMENTS, server.js). `meta` = uniquement primitives non
  // identifiantes issues d'une liste blanche serveur (cf. metaSure). 100 %
  // additif, idempotent, non destructif, réversible (DROP TABLE) — aucun
  // ALTER sur une table existante, aucune FK (volontaire : pas de lien user).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evenements (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_evt_type_date ON evenements(type, cree_le)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_evt_date ON evenements(cree_le)`)
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
