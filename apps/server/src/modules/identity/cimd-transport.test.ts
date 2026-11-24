/**
 * CIMD transport SSRF tests (ADR-0019): client_id metadata documents are
 * fetched through the egress policy — no private ranges, no redirects, no
 * DNS-rebinding to internal addresses, bounded body.
 */
import { describe, expect, test } from 'bun:test'
import { SsrfBlockedError } from '../../api/egress'
import { createCimdFetch } from './cimd-transport'

const PUBLIC_DNS = async () => [{ address: '93.184.216.34', family: 4 }]

describe('CIMD client-metadata transport', () => {
	test('blocks literal private/metadata IPs and internal hostnames', async () => {
		const fetchCimd = createCimdFetch({ resolver: PUBLIC_DNS })
		for (const url of [
			'https://127.0.0.1/client.json',
			'https://169.254.169.254/latest',
			'https://10.0.0.4/meta',
			'https://[fd00::1]/meta',
			'http://localhost/meta',
			'https://evil.internal/meta'
		]) {
			await expect(fetchCimd(url)).rejects.toBeInstanceOf(SsrfBlockedError)
		}
	})

	test('blocks DNS rebinding to a private address', async () => {
		const fetchCimd = createCimdFetch({ resolver: async () => [{ address: '10.1.2.3', family: 4 }] })
		await expect(fetchCimd('https://rebind.example.com/client')).rejects.toBeInstanceOf(SsrfBlockedError)
	})

	test('refuses redirects outright — a client_id must serve its own document', async () => {
		const fetchCimd = createCimdFetch({
			resolver: PUBLIC_DNS,
			fetcher: (async () =>
				new Response(null, {
					status: 302,
					headers: { location: 'https://other.example/doc' }
				})) as unknown as typeof fetch
		})
		await expect(fetchCimd('https://client.example/metadata')).rejects.toBeInstanceOf(SsrfBlockedError)
	})

	test('returns a Response for a public document', async () => {
		const body = JSON.stringify({ client_id: 'https://client.example/metadata' })
		const fetchCimd = createCimdFetch({
			resolver: PUBLIC_DNS,
			fetcher: (async () =>
				new Response(body, {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})) as unknown as typeof fetch
		})
		const res = await fetchCimd('https://client.example/metadata')
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ client_id: 'https://client.example/metadata' })
	})
})
