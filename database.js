const Database = require('better-sqlite3')
const db = new Database('pchelper.db')

// WAL : meilleures lectures concurrentes et résistance aux coupures.
// foreign_keys : SQLite n'applique PAS les clés étrangères sans ça.
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    mot_de_passe TEXT NOT NULL,
    plan TEXT DEFAULT 'gratuit',
    messages_utilises INTEGER DEFAULT 0,
    cree_le DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    contenu TEXT NOT NULL,
    cree_le DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id)
  )
`)

try { db.exec(`ALTER TABLE utilisateurs ADD COLUMN mdp_version INTEGER DEFAULT 0`) } catch {}

db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(utilisateur_id)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(utilisateur_id, session_id)`)

module.exports = db
