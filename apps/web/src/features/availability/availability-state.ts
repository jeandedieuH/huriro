import type { EffectiveAvailabilityState } from '@huriro/contracts'
import type { MessageId } from '@huriro/i18n'

export const AVAILABILITY_STATE_LABEL_ID: Record<EffectiveAvailabilityState, MessageId> = {
	available: 'availability.state.available',
	busy: 'availability.state.busy',
	dnd: 'availability.state.dnd',
	away: 'availability.state.away',
	off_hours: 'availability.state.off_hours',
	ooo: 'availability.state.ooo',
	offline: 'availability.state.offline'
}

export const AVAILABILITY_STATE_ORDER: readonly EffectiveAvailabilityState[] = [
	'available',
	'busy',
	'dnd',
	'off_hours',
	'ooo',
	'away',
	'offline'
]

export function availabilityStateTone(state: EffectiveAvailabilityState): {
	readonly dot: string
	readonly text: string
	readonly badge: string
} {
	switch (state) {
		case 'available':
			return {
				dot: 'bg-success',
				text: 'text-success',
				badge: 'border-success/30 bg-success/10 text-success'
			}
		case 'busy':
			return {
				dot: 'bg-warning',
				text: 'text-warning',
				badge: 'border-warning/30 bg-warning/10 text-warning'
			}
		case 'dnd':
			return {
				dot: 'bg-destructive',
				text: 'text-destructive',
				badge: 'border-destructive/30 bg-destructive/10 text-destructive'
			}
		case 'off_hours':
			return {
				dot: 'bg-info',
				text: 'text-info',
				badge: 'border-info/30 bg-info/10 text-info'
			}
		case 'ooo':
			return {
				dot: 'bg-info',
				text: 'text-info',
				badge: 'border-info/30 bg-info/10 text-info'
			}
		case 'away':
			return {
				dot: 'bg-warning/60',
				text: 'text-warning',
				badge: 'border-warning/30 bg-warning/10 text-warning'
			}
		default:
			return {
				dot: 'bg-muted-foreground/40',
				text: 'text-muted-foreground',
				badge: 'border-border bg-muted text-muted-foreground'
			}
	}
}

/** Accessible non-color cue: each state also has a distinct glyph/shape. */
export function availabilityStateGlyph(state: EffectiveAvailabilityState): string {
	switch (state) {
		case 'available':
			return '●'
		case 'busy':
			return '◐'
		case 'dnd':
			return '⊘'
		case 'off_hours':
			return '◔'
		case 'ooo':
			return '✈'
		case 'away':
			return '◌'
		default:
			return '○'
	}
}
