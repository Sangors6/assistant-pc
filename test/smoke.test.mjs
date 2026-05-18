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
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

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

/* --- Couverture étendue (toujours non destructive : aucune écriture DB) --- */

test('/feedback sans token → 401 (route protégée, aucune écriture)', async () => {
  const r = await fetch(`${BASE}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ positif: true })
  })
  assert.equal(r.status, 401)
})

/* --- Profil PC (modale « première connexion ») — additif, non destructif ---
   Aucune écriture : sans token les routes rejettent AVANT toute requête DB. */

test('POST /profil/pc sans token → 401 (garde-accès, aucune écriture)', async () => {
  const r = await fetch(`${BASE}/profil/pc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cpu: 'Intel Core i5' })
  })
  assert.equal(r.status, 401)
})

test('POST /profil/pc token bidon → 401 (jamais 500, aucune fuite)', async () => {
  const r = await fetch(`${BASE}/profil/pc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': 'Bearer bidon' },
    body: JSON.stringify({ cpu: 'x' })
  })
  assert.equal(r.status, 401)
  assert.notEqual(r.status, 500)
})

test('POST /profil/pc payload vide + token bidon → 401 (auth avant validation)', async () => {
  const r = await fetch(`${BASE}/profil/pc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': 'Bearer bidon' },
    body: '{}'
  })
  // L'auth prime : 401 attendu, jamais 500.
  assert.equal(r.status, 401)
  assert.notEqual(r.status, 500)
})

test('GET /profil sans token → 401 (le flag onboarding reste protégé)', async () => {
  const r = await fetch(`${BASE}/profil`)
  assert.equal(r.status, 401)
})

test('non-régression : /chat & /technicien toujours 401 (fusion matériel n’a rien cassé)', async () => {
  for (const p of ['/chat', '/technicien']) {
    const r = await fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'test' })
    })
    assert.equal(r.status, 401, `${p} garde inchangée`)
  }
})

test('app.html : hooks modale PC + suppression appel mesurerPing périodique', () => {
  const APP_HTML = readFileSync(join(RACINE, 'public', 'app.html'), 'utf8')
  // Hooks critiques de la modale / sidebar refondue présents.
  for (const h of ['id="pc-onboard-overlay"', 'id="pc-onboard-form"',
    'window.ouvrirOnboardPC', 'window.fermerOnboardPC', 'id="pc-card"',
    'id="s-ping"', 'id="s-stockage"', 'id="s-os"', "fetch('/profil/pc'"]) {
    assert.ok(APP_HTML.includes(h), `hook manquant dans app.html : ${h}`)
  }
  // Le polling latence est retiré (plus de setInterval(mesurerPing…)).
  assert.ok(!/setInterval\(\s*mesurerPing/.test(APP_HTML),
    'setInterval(mesurerPing) doit être retiré (latence non affichée)')
})

test('#008 /resolution sans token → 401 (route protégée)', async () => {
  const r = await fetch(`${BASE}/resolution`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: '00000000-0000-4000-8000-000000000000' })
  })
  assert.equal(r.status, 401)
})

test('#008 /resolution/relance sans token → 401', async () => {
  const r = await fetch(`${BASE}/resolution/relance`)
  assert.equal(r.status, 401)
})

test('#008 /resolution/confirme sans token → 401', async () => {
  const r = await fetch(`${BASE}/resolution/confirme`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, tientToujours: true })
  })
  assert.equal(r.status, 401)
})

test('verifier-renvoi sans email → 200 réponse uniforme', async () => {
  const r = await fetch(`${BASE}/auth/verifier-renvoi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.match(j.message, /si un compte/i)
})

test('verifier-confirme token bidon → 400 (jamais 500)', async () => {
  const r = await fetch(`${BASE}/auth/verifier-confirme`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'bidon' })
  })
  assert.equal(r.status, 400)
})

test('verifier.html servi (200)', async () => {
  const r = await fetch(`${BASE}/verifier.html`)
  assert.equal(r.status, 200)
})

test('PWA : manifest.webmanifest servi et JSON valide', async () => {
  const r = await fetch(`${BASE}/manifest.webmanifest`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.name, 'PC Helper — Assistant technique IA')
  assert.equal(j.start_url, '/app.html')
})

test('PWA : service worker sw.js servi', async () => {
  const r = await fetch(`${BASE}/sw.js`)
  assert.equal(r.status, 200)
})

test('en-têtes de sécurité présents (COOP/CORP + no-store API)', async () => {
  const html = await fetch(`${BASE}/login.html`)
  assert.equal(html.headers.get('cross-origin-opener-policy'), 'same-origin')
  assert.equal(html.headers.get('cross-origin-resource-policy'), 'cross-origin')
  const api = await fetch(`${BASE}/auth/moi`)
  assert.equal(api.status, 401)
  assert.equal(api.headers.get('cache-control'), 'no-store')
})

test('connexion compte inexistant → 401 (anti-énumération, aucune écriture)', async () => {
  const r = await fetch(`${BASE}/auth/connexion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'inconnu_smoke@nulle.part', motDePasse: 'x' })
  })
  assert.equal(r.status, 401)
})

/* --- Technicien support expert (route IA dédiée /technicien) --- */

test('POST /technicien sans token → 401 (garde-accès, aucune écriture)', async () => {
  const r = await fetch(`${BASE}/technicien`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'test' })
  })
  assert.equal(r.status, 401)
})

test('POST /technicien token bidon → 401 (jamais 500, aucune fuite)', async () => {
  const r = await fetch(`${BASE}/technicien`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': 'Bearer bidon' },
    body: JSON.stringify({ message: 'test' })
  })
  assert.equal(r.status, 401)
})

test('/technicien.html servi (200)', async () => {
  const r = await fetch(`${BASE}/technicien.html`)
  assert.equal(r.status, 200)
})

test('GET /technicien/statut sans token → 401 (présence protégée)', async () => {
  const r = await fetch(`${BASE}/technicien/statut`)
  assert.equal(r.status, 401)
})

test('GET /technicien/statut token bidon → 401 (jamais 500)', async () => {
  const r = await fetch(`${BASE}/technicien/statut`, {
    headers: { 'Authorization': 'Bearer bidon' }
  })
  assert.equal(r.status, 401)
})

test('GET /technicien/sessions sans token → 401 (historique protégé)', async () => {
  const r = await fetch(`${BASE}/technicien/sessions`)
  assert.equal(r.status, 401)
})

test('non-régression : POST /chat sans token → 401 (garde inchangée)', async () => {
  const r = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'test' })
  })
  assert.equal(r.status, 401)
})

/* --- Bibliothèque de playbooks guidés (#009 — additif, public, no-auth) --- */

test('#009 /playbooks.html servi (200, public)', async () => {
  const r = await fetch(`${BASE}/playbooks.html`)
  assert.equal(r.status, 200)
  const t = await r.text()
  assert.match(t, /Guides de depannage/i)
})

test('#009 /playbooks/playbooks.json servi + JSON valide + 12 playbooks', async () => {
  const r = await fetch(`${BASE}/playbooks/playbooks.json`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.ok(Array.isArray(j.playbooks))
  assert.equal(j.playbooks.length, 12)
  for (const p of j.playbooks) {
    assert.match(p.slug, /^[a-z0-9-]+$/)
    assert.ok(p.noeuds && p.depart && p.noeuds[p.depart], `playbook ${p.slug} cohérent`)
  }
})

test('#009 /sitemap.xml servi (200) + XML bien formé + playbooks listés', async () => {
  const r = await fetch(`${BASE}/sitemap.xml`)
  assert.equal(r.status, 200)
  const x = await r.text()
  assert.match(x, /^<\?xml/)
  assert.match(x, /<urlset[\s\S]*<\/urlset>/)
  assert.equal((x.match(/<loc>/g) || []).length, (x.match(/<\/loc>/g) || []).length)
  assert.match(x, /\/playbooks\/pas-de-son/)
})

test('#009 /robots.txt servi (200) + Sitemap déclaré', async () => {
  const r = await fetch(`${BASE}/robots.txt`)
  assert.equal(r.status, 200)
  const t = await r.text()
  assert.match(t, /User-agent:/i)
  assert.match(t, /Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/i)
})

test('#009 route playbook par slug → 200 + titre SEO + JSON-LD HowTo', async () => {
  const r = await fetch(`${BASE}/playbooks/pas-de-son`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') || '', /text\/html/)
  const t = await r.text()
  assert.match(t, /<title>[^<]*[Pp]as de son[^<]*<\/title>/)
  assert.match(t, /application\/ld\+json/)
  assert.match(t, /"@type"\s*:\s*"HowTo"/)
  assert.match(t, /id="seo-fallback"/)
})

test('#009 chaque slug du JSON est rendu (200) par la route', async () => {
  const data = await (await fetch(`${BASE}/playbooks/playbooks.json`)).json()
  for (const p of data.playbooks) {
    const r = await fetch(`${BASE}/playbooks/${p.slug}`)
    assert.equal(r.status, 200, `slug ${p.slug} doit répondre 200`)
  }
})

test('#009 slug inexistant → 404 propre HTML (jamais 500)', async () => {
  const r = await fetch(`${BASE}/playbooks/slug-qui-nexiste-pas`)
  assert.equal(r.status, 404)
  assert.match(r.headers.get('content-type') || '', /text\/html/)
  const t = await r.text()
  assert.match(t, /introuvable/i)
})

test('#009 slug malformé → 404 (jamais 500, pas de fuite)', async () => {
  for (const bad of ['/playbooks/AAA', '/playbooks/a_b', '/playbooks/x.y']) {
    const r = await fetch(`${BASE}${bad}`)
    assert.equal(r.status, 404, `${bad} doit donner 404, reçu ${r.status}`)
    assert.notEqual(r.status, 500)
  }
})

test('#009 non-régression : /chat & /technicien toujours 401 sans token', async () => {
  for (const p of ['/chat', '/technicien']) {
    const r = await fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'test' })
    })
    assert.equal(r.status, 401, `${p} garde inchangée`)
  }
})

/* --- CONTRAT PANNEAU TECHNICIEN (filet anti-régression P0) -----------------
   Garde-fou statique : si un futur edit supprime un hook critique ou casse la
   syntaxe JS de public/technicien.html, ces tests échouent AVANT la prod.
   Voir docs/CONTRAT-technicien.md. NON destructif, lecture disque seule. */
const TECH_HTML = readFileSync(join(RACINE, 'public', 'technicien.html'), 'utf8')

// Hooks/IDs/fonctions qui NE DOIVENT JAMAIS disparaître sans décision explicite.
const CONTRAT_TECHNICIEN = [
  'tech-restore', 'pageContenuPret', 'id="chat-skeleton"',          // anti-flash
  'id="nav-fx"', 'window.navTo = function', "sessionStorage.setItem('navfx'",
  'decodeAudioData', "d === 'forward'",                              // transition + son
  'function rendrePresence', 'function tirerScenario', 'const DELAIS', // présence
  'function chargerHistoriqueTech', '/technicien/sessions', 'id="hist-panel"', // historique
  'id="notif-bubble"', 'function proposerNotif', 'function notifierReponse',   // notif
  'Temps de réponse estimé', 'function etaScenario',                 // ETA
  'function ajouterMsg', 'async function envoyer', 'sessionIdTech'   // chat coeur
]

test('CONTRAT technicien : tous les hooks critiques présents', () => {
  const manquants = CONTRAT_TECHNICIEN.filter((m) => !TECH_HTML.includes(m))
  assert.deepEqual(manquants, [], `hooks disparus de technicien.html : ${manquants.join(', ')}`)
})

test('CONTRAT technicien : assets média toujours cache-bustés (?v=N)', () => {
  assert.match(TECH_HTML, /swoosh%20tech\.mp3\?v=\d/, 'swoosh doit garder un ?v=N')
  assert.match(TECH_HTML, /notify\.mp3\?v=\d/, 'notify doit garder un ?v=N')
})

test('CONTRAT technicien : tout le JS inline compile (syntaxe valide)', () => {
  const blocs = [...TECH_HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((x) => x[1])
  assert.ok(blocs.length >= 2, 'au moins 2 blocs <script> inline attendus')
  blocs.forEach((code, i) => {
    assert.doesNotThrow(() => new vm.Script(code), `bloc <script> #${i + 1} : erreur de syntaxe JS`)
  })
})

test('CONTRAT : app.html n’a AUCUN audio swoosh (son uniquement à l’aller)', () => {
  const APP_HTML = readFileSync(join(RACINE, 'public', 'app.html'), 'utf8')
  assert.ok(!/snd-swoosh/.test(APP_HTML), 'app.html ne doit pas réintroduire le swoosh')
})

/* --- Anti-bot inscription (F-14/RT-002) — non destructif ------------------ */

test('GET /auth/challenge → 200 + jeton signé, no-store', async () => {
  const r = await fetch(`${BASE}/auth/challenge`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  const j = await r.json()
  assert.equal(typeof j.jeton, 'string')
  assert.match(j.jeton, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'format <payload>.<hmac>')
})

test('inscription honeypot rempli → 200 réponse uniforme (aucune fuite de détection)', async () => {
  const r = await fetch(`${BASE}/auth/inscription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // website (honeypot) rempli + jeton absent : doit répondre EXACTEMENT
    // comme un succès, sans jamais révéler la détection ni créer de compte.
    body: JSON.stringify({ email: 'bot_smoke@nulle.part', motDePasse: 'Zq7v-Tn4_Wx9pK2!aL', website: 'http://spam' })
  })
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.match(j.message, /si l'adresse est valide/i)
})

test('inscription sans jeton → 200 réponse uniforme (jeton manquant traité comme bot, non révélé)', async () => {
  const r = await fetch(`${BASE}/auth/inscription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sansjeton_smoke@nulle.part', motDePasse: 'Zq7v-Tn4_Wx9pK2!aL' })
  })
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.match(j.message, /si l'adresse est valide/i)
})

test('CONTRAT RT-D1 : plafond global inscription = coupe-circuit 429 explicite (pas de faux succès)', () => {
  const S = readFileSync(join(RACINE, 'server.js'), 'utf8')
  // Seuil monté en constante claire à 120/h.
  assert.match(S, /ANTIBOT_PLAFOND_GLOBAL_INSCRIPTION\s*=\s*120/,
    'seuil global inscription doit être la constante 120/h')
  // Plafond email reste à 60/h (reset/verif), inchangé.
  assert.match(S, /ANTIBOT_PLAFOND_EMAIL\s*=\s*60/,
    'plafond email reset/verif doit rester 60/h')
  // Saturation → 429 trop_de_demandes (jamais la réponse uniforme de succès).
  assert.match(S, /if \(!antibotPlafondOk\(\)\) \{[\s\S]{0,200}?res\.status\(429\)\.json\(\{[\s\S]{0,120}?erreur: 'trop_de_demandes'/,
    'plafond saturé doit renvoyer 429 trop_de_demandes')
  // Garde-fou anti-régression : le faux succès silencieux ne doit plus exister
  // dans ce bloc (return res.json(reponseUniforme) juste après le plafond).
  assert.ok(!/if \(!antibotPlafondOk\(\)\) \{[\s\S]{0,200}?res\.json\(reponseUniforme\)/.test(S),
    'le plafond saturé ne doit PLUS renvoyer un faux succès uniforme')
  // Alerte opérateur au franchissement, dédupliquée (une fois par fenêtre).
  assert.match(S, /\[ALERTE ANTIBOT\] plafond global inscription atteint/,
    'une alerte opérateur doit être émise au franchissement')
})

test('CONTRAT RT-Q1 : quota remboursé UNIQUEMENT si rien livré (contenuLivre)', () => {
  const S = readFileSync(join(RACINE, 'server.js'), 'utf8')
  // Le flag existe et est armé après émission d'un chunk.
  assert.ok(S.includes('let contenuLivre = false'),
    'flag contenuLivre doit être déclaré')
  assert.ok(S.includes('contenuLivre = true'),
    'contenuLivre doit passer à true après un chunk livré')
  // Tout remboursement de quota est désormais gardé par !contenuLivre :
  // aucun libererQuota inconditionnel ne doit subsister dans les 2 routes SSE.
  const nbGarde = (S.match(/if \(!contenuLivre\) await libererQuota/g) || []).length
  assert.ok(nbGarde >= 6,
    `tous les remboursements doivent être gardés par !contenuLivre (trouvés: ${nbGarde})`)
})

test('CONTRAT Q-4 : HMAC challenge à séparation de domaine (préfixe de contexte)', () => {
  const S = readFileSync(join(RACINE, 'server.js'), 'utf8')
  assert.match(S, /ANTIBOT_HMAC_CONTEXTE\s*=\s*'pchallenge:v1:'/,
    'constante de contexte HMAC challenge attendue')
  // Le préfixe doit être appliqué côté signature ET vérification.
  const occ = (S.match(/ANTIBOT_HMAC_CONTEXTE \+ p/g) || []).length
  assert.equal(occ, 2,
    'le préfixe de contexte doit être utilisé en signature ET en vérification')
})

test('CONTRAT Q-2 : GET /auth/challenge protégé par un rate-limit', () => {
  const S = readFileSync(join(RACINE, 'server.js'), 'utf8')
  assert.match(S, /app\.get\('\/auth\/challenge', limiteurChallenge,/,
    '/auth/challenge doit passer par limiteurChallenge')
  assert.ok(S.includes('const limiteurChallenge = rateLimit('),
    'limiteurChallenge doit être défini')
})

test('login.html : honeypot + input challenge + fetch /auth/challenge présents', () => {
  const L = readFileSync(join(RACINE, 'public', 'login.html'), 'utf8')
  for (const h of ['id="website"', 'id="antibot-challenge"', "fetch('/auth/challenge'",
    'aria-hidden="true"', 'tabindex="-1"']) {
    assert.ok(L.includes(h), `hook anti-bot manquant dans login.html : ${h}`)
  }
})

/* --- Pages légales (RGPD/LCEN) — servies statiquement, non destructif ----- */

test('pages légales servies (200) + contenu clé', async () => {
  const cas = [
    ['/mentions-legales.html', /Mentions légales/i],
    ['/confidentialite.html', /confidentialité/i],
    ['/cgu.html', /Conditions générales/i],
    ['/cookies.html', /cookies/i]
  ]
  for (const [url, motif] of cas) {
    const r = await fetch(`${BASE}${url}`)
    assert.equal(r.status, 200, `${url} doit être servi`)
    assert.match(r.headers.get('content-type') || '', /text\/html/)
    const t = await r.text()
    assert.match(t, motif, `${url} contenu attendu`)
  }
})

test('confidentialité : ancre #securite présente (lien footer "Sécurité")', async () => {
  const t = await (await fetch(`${BASE}/confidentialite.html`)).text()
  assert.match(t, /id="securite"/)
})

test('CGU : clause "ne remplace pas un professionnel" + "aucune garantie de résultat"', async () => {
  const t = await (await fetch(`${BASE}/cgu.html`)).text()
  assert.match(t, /NE REMPLACE PAS/i)
  assert.match(t, /aucune garantie de résultat/i)
})

test('sitemap.xml : 4 pages légales listées + XML toujours bien formé', async () => {
  const x = await (await fetch(`${BASE}/sitemap.xml`)).text()
  for (const p of ['/mentions-legales.html', '/confidentialite.html', '/cgu.html', '/cookies.html']) {
    assert.ok(x.includes(p), `${p} absent du sitemap`)
  }
  assert.equal((x.match(/<loc>/g) || []).length, (x.match(/<\/loc>/g) || []).length)
})

test('index.html : liens légaux du footer ne sont plus des href="#"', () => {
  const I = readFileSync(join(RACINE, 'public', 'index.html'), 'utf8')
  for (const h of ['/confidentialite.html', '/cgu.html', '/cookies.html',
    '/mentions-legales.html', 'confidentialite.html#securite']) {
    assert.ok(I.includes(h), `lien légal attendu dans index.html : ${h}`)
  }
  // RT-Q (qualité) : le lien Contact mailto:[email] (placeholder brut cassé)
  // a été remplacé par /mentions-legales.html → il ne doit PLUS réapparaître.
  assert.ok(!I.includes('mailto:[email]'),
    'le lien Contact cassé mailto:[email] ne doit plus être présent')
})

