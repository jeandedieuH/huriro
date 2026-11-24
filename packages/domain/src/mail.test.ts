import { describe, expect, it } from 'bun:test'
import { isPlausibleEmail, normalizeEmail, normalizeMailSubject, threadingKeyMatches } from './mail'

describe('normalizeMailSubject', () => {
	it('strips reply/forward prefixes', () => {
		expect(normalizeMailSubject('Re: Hello')).toBe('hello')
		expect(normalizeMailSubject('Fwd: Hello')).toBe('hello')
		expect(normalizeMailSubject('Re: Fwd: Re: Hello')).toBe('hello')
		expect(normalizeMailSubject('RE:  Hello  World')).toBe('hello world')
	})
	it('strips non-prefix bracket tags but keeps content', () => {
		expect(normalizeMailSubject('[List-Tag] Hello')).toBe('hello')
	})
	it('handles empty/null', () => {
		expect(normalizeMailSubject('')).toBe('')
		expect(normalizeMailSubject(null)).toBe('')
		expect(normalizeMailSubject(undefined)).toBe('')
	})
	it('equates different prefixes on same subject', () => {
		expect(normalizeMailSubject('Re: Billing question')).toBe(normalizeMailSubject('Fwd: billing question'))
	})
})

describe('threadingKeyMatches', () => {
	it('matches equal normalized subjects only', () => {
		expect(threadingKeyMatches({ normalizedSubject: 'hi' }, { normalizedSubject: 'hi' })).toBe(true)
		expect(threadingKeyMatches({ normalizedSubject: 'hi' }, { normalizedSubject: 'bye' })).toBe(false)
		expect(threadingKeyMatches({ normalizedSubject: '' }, { normalizedSubject: '' })).toBe(false)
	})
})

describe('email helpers', () => {
	it('normalizeEmail lowercases and trims', () => {
		expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
	})
	it('isPlausibleEmail validates basics', () => {
		expect(isPlausibleEmail('a@b.co')).toBe(true)
		expect(isPlausibleEmail('not-an-email')).toBe(false)
		expect(isPlausibleEmail('a@b')).toBe(false)
	})
})
