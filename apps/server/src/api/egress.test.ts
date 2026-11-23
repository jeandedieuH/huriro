import { describe, expect, test } from 'bun:test'
import { isBlockedIp, SsrfBlockedError, safeEgressFetch, validateAndResolveEgressUrl } from './egress'

describe('SSRF-safe egress proxy (§12.6)', () => {
	test('blocks private, loopback, link-local, metadata, and IPv6 ULA/mapped ranges', () => {
		expect(isBlockedIp('127.0.0.1')).toBe(true)
		expect(isBlockedIp('10.20.30.40')).toBe(true)
		expect(isBlockedIp('172.16.0.1')).toBe(true)
		expect(isBlockedIp('172.31.255.255')).toBe(true)
		expect(isBlockedIp('192.168.1.50')).toBe(true)
		expect(isBlockedIp('169.254.169.254')).toBe(true)
		expect(isBlockedIp('100.64.0.1')).toBe(true)
		expect(isBlockedIp('0.0.0.0')).toBe(true)
		expect(isBlockedIp('::1')).toBe(true)
		expect(isBlockedIp('::')).toBe(true)
		expect(isBlockedIp('fe80::1')).toBe(true)
		expect(isBlockedIp('fd12:3456::1')).toBe(true)
		expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true)
		expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true)

		expect(isBlockedIp('93.184.216.34')).toBe(false)
		expect(isBlockedIp('2606:4700:4700::1111')).toBe(false)
	})

	test('rejects non-http schemes, embedded credentials, and internal hostnames', async () => {
		await expect(validateAndResolveEgressUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError)
		await expect(validateAndResolveEgressUrl('gopher://1.2.3.4/1')).rejects.toBeInstanceOf(SsrfBlockedError)
		await expect(validateAndResolveEgressUrl('https://user:pass@example.com/')).rejects.toBeInstanceOf(
			SsrfBlockedError
		)
		await expect(validateAndResolveEgressUrl('http://localhost/admin')).rejects.toBeInstanceOf(
			SsrfBlockedError
		)
		await expect(validateAndResolveEgressUrl('http://metadata.google.internal/')).rejects.toBeInstanceOf(
			SsrfBlockedError
		)
	})

	test('blocks DNS resolution returning private IP and follows up to 3 public redirects', async () => {
		await expect(
			validateAndResolveEgressUrl('https://rebind.example/hook', async () => [
				{ address: '10.0.0.5', family: 4 }
			])
		).rejects.toBeInstanceOf(SsrfBlockedError)

		const resolver = async (host: string) =>
			host === 'evil-internal.test'
				? [{ address: '127.0.0.1', family: 4 }]
				: [{ address: '93.184.216.34', family: 4 }]

		// Redirect into loopback must block
		await expect(
			safeEgressFetch('https://public.example/start', {
				resolver,
				fetcher: (async () =>
					new Response(null, {
						status: 302,
						headers: { location: 'http://evil-internal.test/secret' }
					})) as unknown as typeof fetch
			})
		).rejects.toBeInstanceOf(SsrfBlockedError)

		// More than 3 redirects must fail
		let hops = 0
		await expect(
			safeEgressFetch('https://public.example/0', {
				resolver,
				fetcher: (async () => {
					hops += 1
					return new Response(null, {
						status: 302,
						headers: { location: `https://public.example/${hops}` }
					})
				}) as unknown as typeof fetch
			})
		).rejects.toBeInstanceOf(SsrfBlockedError)

		// Successful bounded fetch
		const ok = await safeEgressFetch('https://public.example/doc', {
			resolver,
			fetcher: (async () =>
				new Response('<title>Huriro Docs</title>', {
					status: 200,
					headers: { 'content-type': 'text/html' }
				})) as unknown as typeof fetch
		})
		expect(ok.status).toBe(200)
		expect(new TextDecoder().decode(ok.bodyBytes)).toContain('Huriro Docs')
	})

	test('caps oversized response bodies', async () => {
		await expect(
			safeEgressFetch('https://public.example/huge', {
				maxBytes: 16,
				resolver: async () => [{ address: '93.184.216.34', family: 4 }],
				fetcher: (async () => new Response('x'.repeat(100), { status: 200 })) as unknown as typeof fetch
			})
		).rejects.toBeInstanceOf(SsrfBlockedError)
	})
})
