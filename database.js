const Database = require('better-sqlite3')
const db = new Database('pchelper.db')

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

module.exports = db