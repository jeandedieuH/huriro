import { describe, expect, test } from 'bun:test'
import {
	computeDmKey,
	computeWebhookBackoffMs,
	extractChatMentions,
	extractRichLinks,
	extractUrls,
	isWithinQuietHours
} from './chat'

describe('domain chat helpers', () => {
	test('extractChatMentions captures handles and @channel/@here', () => {
		const res = extractChatMentions('Hey @alice and @bob@huriro.dev, check @channel and @here!')
		expect(res.handles).toEqual(['alice', 'bob@huriro.dev'])
		expect(res.mentionChannel).toBe(true)
		expect(res.mentionHere).toBe(true)
	})

	test('extractUrls strips trailing punctuation and caps at 5', () => {
		const urls = extractUrls(
			'See https://example.com/a, http://foo.test/b?x=1. Also https://1.test https://2.test https://3.test https://4.test'
		)
		expect(urls).toEqual([
			'https://example.com/a',
			'http://foo.test/b?x=1',
			'https://1.test/',
			'https://2.test/',
			'https://3.test/'
		])
	})

	test('extractRichLinks parses issue, doc, and conversation tokens', () => {
		const links = extractRichLinks(
			'Linked issue:ENG-42 and https://app.huriro.dev/docs/rfc-sync plus conversation:conv_99'
		)
		expect(links).toEqual([
			{ kind: 'issue', ref: 'ENG-42', raw: 'issue:ENG-42' },
			{ kind: 'doc_page', ref: 'rfc-sync', raw: '/docs/rfc-sync' },
			{ kind: 'conversation', ref: 'conv_99', raw: 'conversation:conv_99' }
		])
	})

	test('computeDmKey is order-independent and deduplicated', () => {
		const a = '0190a0b1-0000-7000-8000-000000000002'
		const b = '0190a0b1-0000-7000-8000-000000000001'
		expect(computeDmKey([a, b, a])).toBe(`${b}:${a}`)
	})

	test('isWithinQuietHours supports overnight windows and timezones', () => {
		// 23:30 UTC -> inside 22:00..07:00 UTC
		expect(isWithinQuietHours('2026-11-23T23:30:00Z', '22:00', '07:00', 'UTC')).toBe(true)
		// 06:59 UTC -> inside 22:00..07:00 UTC
		expect(isWithinQuietHours('2026-11-23T06:59:00Z', '22:00', '07:00', 'UTC')).toBe(true)
		// 12:00 UTC -> outside 22:00..07:00 UTC
		expect(isWithinQuietHours('2026-11-23T12:00:00Z', '22:00', '07:00', 'UTC')).toBe(false)
		// 14:00 UTC = 09:00 America/New_York (EST UTC-5) -> inside 09:00..17:00 EST
		expect(isWithinQuietHours('2026-11-23T14:00:00Z', '09:00', '17:00', 'America/New_York')).toBe(true)
		// Invalid/unset -> false
		expect(isWithinQuietHours('2026-11-23T23:30:00Z', null, null, 'UTC')).toBe(false)
	})

	test('computeWebhookBackoffMs enforces 24h exponential schedule and maxAttempts', () => {
		expect(computeWebhookBackoffMs(1)).toBe(30_000)
		expect(computeWebhookBackoffMs(2)).toBe(120_000)
		expect(computeWebhookBackoffMs(7)).toBe(54_000_000)
		expect(computeWebhookBackoffMs(8, 8)).toBeNull()
	})
})
