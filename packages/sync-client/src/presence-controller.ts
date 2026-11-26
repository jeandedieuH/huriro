/**
 * Platform-agnostic presence activity controller (ADR-0035, §15.2).
 *
 * Converts real activity/visibility signals into the ephemeral
 * `online | away` WS presence hint — never a database heartbeat. Web wires
 * DOM activity + `visibilitychange`; mobile wires `AppState`; both share this
 * state machine so auto-idle behaves identically.
 */

export type PresenceState = 'online' | 'away'

export interface PresenceControllerOptions {
	/** Transport writer — typically `syncEngine.sendPresence`. */
	readonly sendPresence: (status: PresenceState) => void
	readonly now?: (() => number) | undefined
	readonly setTimeoutFn?: ((fn: () => void, ms: number) => ReturnType<typeof setTimeout>) | undefined
	readonly clearTimeoutFn?: ((handle: ReturnType<typeof setTimeout>) => void) | undefined
	readonly idleTimeoutMs?: number | undefined
	readonly backgroundGraceMs?: number | undefined
	readonly minSendGapMs?: number | undefined
	readonly onStateChange?: ((state: PresenceState) => void) | undefined
}

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000
const DEFAULT_BACKGROUND_GRACE_MS = 30_000
const DEFAULT_MIN_SEND_GAP_MS = 5_000

export class PresenceActivityController {
	private readonly sendPresence: (status: PresenceState) => void
	private readonly now: () => number
	private readonly setTimeoutFn: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
	private readonly clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void
	private readonly idleTimeoutMs: number
	private readonly backgroundGraceMs: number
	private readonly minSendGapMs: number
	private readonly onStateChange: ((state: PresenceState) => void) | undefined

	private state: PresenceState = 'online'
	private running = false
	private hidden = false
	private lastSentAt = 0
	private lastSentState: PresenceState | null = null
	private idleTimer: ReturnType<typeof setTimeout> | null = null
	private backgroundTimer: ReturnType<typeof setTimeout> | null = null

	constructor(opts: PresenceControllerOptions) {
		this.sendPresence = opts.sendPresence
		this.now = opts.now ?? (() => Date.now())
		this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
		this.clearTimeoutFn = opts.clearTimeoutFn ?? ((handle) => clearTimeout(handle))
		this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
		this.backgroundGraceMs = opts.backgroundGraceMs ?? DEFAULT_BACKGROUND_GRACE_MS
		this.minSendGapMs = opts.minSendGapMs ?? DEFAULT_MIN_SEND_GAP_MS
		this.onStateChange = opts.onStateChange
	}

	getState(): PresenceState {
		return this.state
	}

	start(): void {
		if (this.running) return
		this.running = true
		this.state = 'online'
		this.scheduleIdle()
		if (this.hidden) this.setHidden(true)
		this.flush(true)
	}

	stop(): void {
		this.running = false
		this.clearTimer('idle')
		this.clearTimer('background')
	}

	/** Any user input: keyboard, pointer, touch, scroll. */
	noteActivity(): void {
		if (!this.running) return
		if (this.state !== 'online') this.setState('online')
		this.scheduleIdle()
	}

	/** Web `document.visibilitychange` / mobile app background. */
	setHidden(hidden: boolean): void {
		this.hidden = hidden
		if (!this.running) return
		if (hidden) {
			this.clearTimer('background')
			this.backgroundTimer = this.setTimeoutFn(() => {
				this.backgroundTimer = null
				if (this.hidden) this.setState('away')
			}, this.backgroundGraceMs)
			return
		}
		this.clearTimer('background')
		this.setState('online')
		this.scheduleIdle()
	}

	/** Replay the current state after a WS reconnect (the server drops it). */
	onReconnect(): void {
		if (!this.running) return
		this.flush(true)
	}

	private scheduleIdle(): void {
		this.clearTimer('idle')
		this.idleTimer = this.setTimeoutFn(() => {
			this.idleTimer = null
			if (!this.hidden) this.setState('away')
		}, this.idleTimeoutMs)
	}

	private setState(next: PresenceState): void {
		if (this.state === next) {
			this.flush(false)
			return
		}
		this.state = next
		this.onStateChange?.(next)
		this.flush(false)
	}

	private flush(force: boolean): void {
		const now = this.now()
		if (!force && this.lastSentState === this.state) return
		if (!force && now - this.lastSentAt < this.minSendGapMs) {
			// Coalesce a rapid flip; the next activity/reconnect sends it.
			return
		}
		this.lastSentAt = now
		this.lastSentState = this.state
		try {
			this.sendPresence(this.state)
		} catch {
			// A closed socket must never break UI activity handling.
		}
	}

	private clearTimer(kind: 'idle' | 'background'): void {
		if (kind === 'idle' && this.idleTimer) {
			this.clearTimeoutFn(this.idleTimer)
			this.idleTimer = null
		}
		if (kind === 'background' && this.backgroundTimer) {
			this.clearTimeoutFn(this.backgroundTimer)
			this.backgroundTimer = null
		}
	}
}
