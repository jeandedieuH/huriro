import { describe, expect, test } from 'bun:test'
import { PresenceActivityController, type PresenceState } from './presence-controller'

function harness(opts?: { idleTimeoutMs?: number; backgroundGraceMs?: number; minSendGapMs?: number }) {
	let now = 1_000
	const sent: { state: PresenceState; at: number }[] = []
	const timers = new Map<number, { fn: () => void; due: number }>()
	let nextTimer = 1
	const controller = new PresenceActivityController({
		sendPresence: (state) => sent.push({ state, at: now }),
		now: () => now,
		idleTimeoutMs: opts?.idleTimeoutMs ?? 1_000,
		backgroundGraceMs: opts?.backgroundGraceMs ?? 500,
		minSendGapMs: opts?.minSendGapMs ?? 0,
		setTimeoutFn: (fn, ms) => {
			const id = nextTimer++
			timers.set(id, { fn, due: now + ms })
			return id as unknown as ReturnType<typeof setTimeout>
		},
		clearTimeoutFn: (handle) => {
			timers.delete(handle as unknown as number)
		}
	})
	function advance(ms: number) {
		now += ms
		for (const [id, timer] of [...timers]) {
			if (timer.due <= now) {
				timers.delete(id)
				timer.fn()
			}
		}
	}
	return {
		controller,
		sent,
		advance,
		get now() {
			return now
		}
	}
}

describe('PresenceActivityController', () => {
	test('starts online and goes away after the idle timeout', () => {
		const h = harness()
		h.controller.start()
		expect(h.sent.map((s) => s.state)).toEqual(['online'])
		h.advance(1_000)
		expect(h.controller.getState()).toBe('away')
		expect(h.sent.map((s) => s.state)).toEqual(['online', 'away'])
	})

	test('activity restores online immediately and resets idle', () => {
		const h = harness()
		h.controller.start()
		h.advance(1_000)
		expect(h.controller.getState()).toBe('away')
		h.controller.noteActivity()
		expect(h.controller.getState()).toBe('online')
		h.advance(900)
		expect(h.controller.getState()).toBe('online')
		h.advance(100)
		expect(h.controller.getState()).toBe('away')
	})

	test('background grace marks away, foreground restores online', () => {
		const h = harness()
		h.controller.start()
		h.controller.setHidden(true)
		h.advance(499)
		expect(h.controller.getState()).toBe('online')
		h.advance(1)
		expect(h.controller.getState()).toBe('away')
		h.controller.setHidden(false)
		expect(h.controller.getState()).toBe('online')
	})

	test('reconnect replays the current state', () => {
		const h = harness()
		h.controller.start()
		h.advance(1_000)
		h.sent.length = 0
		h.controller.onReconnect()
		expect(h.sent).toEqual([{ state: 'away', at: h.now }])
	})

	test('throttles rapid flips under the minimum send gap', () => {
		const h = harness({ minSendGapMs: 5_000, idleTimeoutMs: 10_000, backgroundGraceMs: 10_000 })
		h.controller.start()
		expect(h.sent).toHaveLength(1)
		h.controller.setHidden(true)
		h.advance(10_000)
		// Timer reaches away; send is throttled (only 10s elapsed from start, so not throttled).
		expect(h.sent.at(-1)?.state).toBe('away')
		h.controller.setHidden(false)
		h.controller.setHidden(true)
		h.advance(10_000)
		expect(h.sent.at(-1)?.state).toBe('away')
	})
})
