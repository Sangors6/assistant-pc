// Tests de fumée — NON DESTRUCTIFS. Aucune écriture en base : on ne vérifie
// que des routes en lecture seule, des gardes d'accès et des comportements
// inertes. Lancé via `npm test` (node:test natif, aucune dépendance).
//
// Le serveur est démarré en HTTP simple sur un port de test dédié
// (NODE_ENV=production -> pas de TLS/redirection, cf. server.js), puis arrêté.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3010
const BASE = `http://127.0.0.1:${PORT}`
let serveur

async function attendrePret(timeoutMs = 20000) {
  const fin = Date.now() + timeoutMs
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('Le serveur de test n’a pas démarré à temps')
}

before(async () => {
  serveur = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: 'ignore'
  })
  await attendrePret()
})

after(() => {
  if (serveur && !serveur.killed) serveur.kill()
})

test('/health → 200 + status ok + db vivante', async () => {
  const r = await fetch(`${BASE}/health`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.status, 'ok')
  assert.equal(j.services.db, true)
  assert.equal(typeof j.uptime_s, 'number')
})

test('route inconnue → 404 JSON cohérent', async () => {
  const r = await fetch(`${BASE}/route-qui-nexiste-pas`)
  assert.equal(r.status, 404)
  const j = await r.json()
  assert.equal(j.erreur, 'Introuvable')
})

test('fichiers sensibles non exposés (server.js, .env)', async () => {
  for (const p of ['/server.js', '/.env', '/database.js']) {
    const r = await fetch(`${BASE}${p}`)
    assert.equal(r.status, 404, `${p} ne doit pas être servi`)
  }
})

test('routes authentifiées sans token → 401', async () => {
  for (const p of ['/auth/moi', '/profil', '/sessions']) {
    const r = await fetch(`${BASE}${p}`)
    assert.equal(r.status, 401, `${p} doit exiger un token`)
  }
})

test('POST /paiement/creer-session sans token → 401', async () => {
  const r = await fetch(`${BASE}/paiement/creer-session`, { method: 'POST' })
  assert.equal(r.status, 401)
})

test('POST /paiement/webhook sans Stripe configuré → 503 (inerte)', async () => {
  const r = await fetch(`${BASE}/paiement/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  assert.equal(r.status, 503)
})

test('reset-confirme avec token bidon → 400 (jamais 500)', async () => {
  const r = await fetch(`${BASE}/auth/reset-confirme`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'bidon', motDePasse: 'x' })
  })
  assert.equal(r.status, 400)
})

test('reset-demande sans email → 200 réponse uniforme, aucune écriture', async () => {
  const r = await fetch(`${BASE}/auth/reset-demande`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.match(j.message, /si un compte existe/i)
})

test('page d’accueil servie (200)', async () => {
  const r = await fetch(`${BASE}/`)
  assert.equal(r.status, 200)
})

test('JSON malformé → 400 (gestionnaire d’erreurs global)', async () => {
  const r = await fetch(`${BASE}/auth/connexion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ ceci nest pas du json'
  })
  assert.equal(r.status, 400)
})
