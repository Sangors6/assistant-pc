/* Service Worker PC Helper — STRATÉGIE NETWORK-FIRST.
 *
 * Objectif : rendre l'app installable et résiliente hors-ligne SANS jamais
 * servir une version périmée quand le réseau est là (piège classique des
 * SW). Donc : réseau d'abord, cache seulement en repli hors-ligne.
 *
 * Règles dures :
 *  - Les requêtes non-GET (POST /auth, /chat, /feedback…) ne sont JAMAIS
 *    interceptées → comportement réseau natif inchangé.
 *  - Les routes d'API GET sont laissées au réseau natif (jamais cachées).
 *  - Les ressources cross-origin (CDN) ne sont pas touchées.
 *  - skipWaiting + clients.claim → une nouvelle version s'active vite.
 */
const CACHE = 'pchelper-pwa-v1'
const SHELL = ['/', '/index.html', '/login.html', '/app.html', '/favicon.svg']

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})))
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

const API = /^\/(auth|chat|feedback|health|sessions|historique|profil|paiement)\b/

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return                 // POST/PUT… : réseau natif
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return  // CDN/externe : non touché
  if (API.test(url.pathname)) return               // API : jamais cachée

  // Navigations + assets statiques : réseau d'abord, repli cache hors-ligne.
  e.respondWith((async () => {
    try {
      const net = await fetch(req)
      if (net && net.ok) {
        const c = await caches.open(CACHE)
        c.put(req, net.clone()).catch(() => {})
      }
      return net
    } catch {
      const hit = await caches.match(req)
      return hit || (await caches.match('/')) || Response.error()
    }
  })())
})

/* Clic sur une notification « le technicien a répondu » : on ramène le
 * client sur l'onglet technicien (focus s'il est déjà ouvert, sinon ouvre).
 * Notification LOCALE déclenchée par la page (pas une push serveur : la
 * réponse n'est produite que pendant que la page tient la requête). */
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of fenetres) {
      if (c.url.includes('/technicien') && 'focus' in c) return c.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow('/technicien.html')
  })())
})
