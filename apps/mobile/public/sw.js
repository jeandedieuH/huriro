const CACHE_NAME = 'huriro-shell-v1'
const PRECACHE_URLS = ['/manifest.webmanifest', '/images/icon.png']

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(PRECACHE_URLS))
			.then(() => self.skipWaiting())
	)
})

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	)
})

self.addEventListener('fetch', (event) => {
	const req = event.request
	if (req.method !== 'GET') return

	const url = new URL(req.url)
	if (url.origin !== self.location.origin) return

	// Never cache dynamic API, auth, MCP, or metrics payloads in the SW cache.
	if (
		url.pathname.startsWith('/api/') ||
		url.pathname.startsWith('/mcp') ||
		url.pathname.startsWith('/health') ||
		url.pathname.startsWith('/ready') ||
		url.pathname.startsWith('/metrics')
	) {
		return
	}

	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req).catch(async () => {
				const cached = await caches.match('/')
				return cached ?? Response.error()
			})
		)
		return
	}

	if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/')) {
		event.respondWith(
			caches.open(CACHE_NAME).then(async (cache) => {
				const cached = await cache.match(req)
				if (cached) return cached
				const res = await fetch(req)
				if (res.ok) {
					void cache.put(req, res.clone())
				}
				return res
			})
		)
	}
})
