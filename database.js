const Database = require('better-sqlite3')
const db = new Database('pchelper.db')

// Crée la table utilisateurs si elle n'existe pas
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

module.exports = db