/**
 * migrate-data.js — Migration ponctuelle SQLite (pchelper.db) -> PostgreSQL.
 *
 * Transfère tous les utilisateurs et toutes les conversations de l'ancienne
 * base SQLite locale vers la base PostgreSQL définie par DATABASE_URL.
 *
 * Propriétés :
 *  - Idempotent : ré-exécutable sans créer de doublon (utilisateurs dédupliqués
 *    par email, conversations par (utilisateur, session, rôle, contenu, date)).
 *  - Préserve les dates d'origine (cree_le) pour garder l'historique cohérent.
 *  - Tolérant aux erreurs : une ligne en échec n'interrompt pas la migration ;
 *    tout est compté et résumé à la fin.
 *
 * Usage : node migrate-data.js
 */

require('dotenv').config({ path: '.env' })
const path = require('path')
const fs = require('fs')

const SQLITE_PATH = path.join(__dirname, 'pchelper.db')

// ---- Lecture SQLite (better-sqlite3 si dispo, sinon node:sqlite intégré) ----
function ouvrirSqlite(fichier) {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(fichier, { readonly: true, fileMustExist: true })
    return {
      all: (sql) => db.prepare(sql).all(),
      close: () => db.close()
    }
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e
    const { DatabaseSync } = require('node:sqlite') // Node 22.5+/24
    const db = new DatabaseSync(fichier, { readOnly: true })
    return {
      all: (sql) => db.prepare(sql).all(),
      close: () => db.close()
    }
  }
}

async function main() {
  console.log('=== Migration SQLite -> PostgreSQL ===\n')

  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`Fichier SQLite introuvable : ${SQLITE_PATH}. Rien à migrer.`)
    process.exit(1)
  }

  // database.js : même configuration de connexion que l'app (SSL inclus).
  // Il quitte le process si DATABASE_URL est absent.
  const { query, one, run, pool, initDb } = require('./database')

  let sqlite
  try {
    sqlite = ouvrirSqlite(SQLITE_PATH)
  } catch (e) {
    console.error('Impossible d\'ouvrir pchelper.db :', e.message)
    process.exit(1)
  }

  // Compteurs du résumé final.
  const stats = {
    usersLus: 0, usersMigres: 0, usersExistants: 0, usersErreur: 0,
    convLues: 0, convMigrees: 0, convDoublons: 0, convOrphelines: 0, convErreur: 0
  }

  try {
    // Garantit que le schéma cible existe (idempotent).
    await initDb()

    // ---------------- UTILISATEURS ----------------
    let usersSqlite = []
    try {
      usersSqlite = sqlite.all('SELECT * FROM utilisateurs')
    } catch (e) {
      console.error('Lecture des utilisateurs SQLite impossible :', e.message)
    }
    stats.usersLus = usersSqlite.length

    // Map : ancien id SQLite -> id PostgreSQL (pour relier les conversations).
    const mapUserId = new Map()

    for (const u of usersSqlite) {
      try {
        // Dédup par email (UNIQUE en PG). DO NOTHING si déjà présent.
        const insere = await one(
          `INSERT INTO utilisateurs (email, mot_de_passe, plan, messages_utilises, mdp_version, cree_le)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO NOTHING
           RETURNING id`,
          [
            u.email,
            u.mot_de_passe,
            u.plan || 'gratuit',
            u.messages_utilises || 0,
            u.mdp_version || 0,
            u.cree_le || null
          ]
        )

        let pgId
        if (insere && insere.id) {
          pgId = insere.id
          stats.usersMigres++
        } else {
          // Déjà présent : on récupère son id pour rattacher les conversations.
          const existant = await one('SELECT id FROM utilisateurs WHERE email = $1', [u.email])
          pgId = existant && existant.id
          stats.usersExistants++
        }
        if (pgId) mapUserId.set(u.id, pgId)
      } catch (e) {
        stats.usersErreur++
        console.error(`  ! Utilisateur "${u.email}" ignoré :`, e.message)
      }
    }

    // ---------------- CONVERSATIONS ----------------
    let convSqlite = []
    try {
      convSqlite = sqlite.all('SELECT * FROM conversations ORDER BY cree_le ASC')
    } catch (e) {
      console.error('Lecture des conversations SQLite impossible :', e.message)
    }
    stats.convLues = convSqlite.length

    for (const c of convSqlite) {
      try {
        const pgUserId = mapUserId.get(c.utilisateur_id)
        if (!pgUserId) {
          // Conversation rattachée à un utilisateur absent/non migré.
          stats.convOrphelines++
          continue
        }

        // Dédoublonnage : la table n'a pas de clé naturelle, on teste
        // l'existence d'une ligne strictement identique (date incluse).
        const existe = await one(
          `SELECT 1 FROM conversations
           WHERE utilisateur_id = $1 AND session_id = $2 AND role = $3
             AND contenu = $4 AND cree_le = $5
           LIMIT 1`,
          [pgUserId, c.session_id, c.role, c.contenu, c.cree_le]
        )
        if (existe) {
          stats.convDoublons++
          continue
        }

        await run(
          `INSERT INTO conversations (utilisateur_id, session_id, role, contenu, cree_le)
           VALUES ($1, $2, $3, $4, $5)`,
          [pgUserId, c.session_id, c.role, c.contenu, c.cree_le]
        )
        stats.convMigrees++
      } catch (e) {
        stats.convErreur++
        console.error(`  ! Conversation #${c.id} ignorée :`, e.message)
      }
    }
  } catch (e) {
    console.error('\nErreur générale durant la migration :', e.message)
  } finally {
    try { sqlite.close() } catch {}
    try { await pool.end() } catch {}
  }

  // ---------------- RÉSUMÉ ----------------
  console.log('\n=== Résumé de la migration ===')
  console.log('Utilisateurs   :')
  console.log(`  lus dans SQLite     : ${stats.usersLus}`)
  console.log(`  migrés (nouveaux)   : ${stats.usersMigres}`)
  console.log(`  déjà présents       : ${stats.usersExistants}`)
  console.log(`  en erreur           : ${stats.usersErreur}`)
  console.log('Conversations  :')
  console.log(`  lues dans SQLite    : ${stats.convLues}`)
  console.log(`  migrées (nouvelles) : ${stats.convMigrees}`)
  console.log(`  doublons ignorés    : ${stats.convDoublons}`)
  console.log(`  orphelines ignorées : ${stats.convOrphelines}`)
  console.log(`  en erreur           : ${stats.convErreur}`)
  console.log('\n✅ Migration terminée :', stats.usersMigres, 'utilisateur(s) et',
    stats.convMigrees, 'conversation(s) migré(s).')
}

main().catch((e) => {
  console.error('Échec inattendu :', e)
  process.exit(1)
})
