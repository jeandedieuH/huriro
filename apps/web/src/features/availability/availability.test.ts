import { describe, expect, it } from 'vitest'
import {
	AVAILABILITY_STATE_LABEL_ID,
	AVAILABILITY_STATE_ORDER,
	availabilityStateGlyph,
	availabilityStateTone
} from './availability-state'

describe('availability presentation', () => {
	it('covers every effective state with a distinct glyph', () => {
		const glyphs = AVAILABILITY_STATE_ORDER.map((state) => availabilityStateGlyph(state))
		expect(new Set(glyphs).size).toBe(AVAILABILITY_STATE_ORDER.length)
	})

	it('maps every state to semantic tokens and a catalog label', () => {
		for (const state of AVAILABILITY_STATE_ORDER) {
			expect(availabilityStateTone(state).dot).toContain('bg-')
			expect(AVAILABILITY_STATE_LABEL_ID[state].startsWith('availability.state.')).toBe(true)
		}
	})

	it('uses the destructive token for DND and success for available', () => {
		expect(availabilityStateTone('dnd').dot).toBe('bg-destructive')
		expect(availabilityStateTone('available').dot).toBe('bg-success')
	})
})
