import { describe, expect, test } from 'bun:test'
import { en } from '../locales/en'
import { pseudo } from '../locales/pseudo'
import { activateI18n, t } from './index'

describe('i18n', () => {
	test('en catalog resolves', () => {
		activateI18n('en')
		expect(t('app.name')).toBe('Huriro')
		expect(t('nav.tasks')).toBe('Tasks')
	})

	test('pseudo locale wraps + accents every message', () => {
		for (const [id, msg] of Object.entries(en)) {
			const p = (pseudo as Record<string, string>)[id]
			if (!p) throw new Error(`missing pseudo for ${id}`)
			expect(p).toStartWith('⟪')
			expect(p).toContain('⟫')
			expect(p.length).toBeGreaterThan(msg.length)
		}
		activateI18n('pseudo')
		expect(t('app.name')).toContain('⟪')
	})
})
