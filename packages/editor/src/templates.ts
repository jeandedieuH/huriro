export interface DocTemplate {
	readonly id: string
	readonly title: string
	readonly description: string
	readonly icon: string
	readonly markdown: string
}

export const BUILTIN_DOC_TEMPLATES: readonly DocTemplate[] = [
	{
		id: 'blank',
		title: 'Blank page',
		description: 'Start from an empty canvas.',
		icon: 'file-text',
		markdown: ''
	},
	{
		id: 'rfc',
		title: 'Engineering RFC',
		description: 'Context, options considered, decision, and rollout plan.',
		icon: 'compass',
		markdown: [
			'# RFC: Title',
			'',
			'> [!NOTE] Status: Draft · Owner: @author',
			'',
			'## Context',
			'',
			'Describe the problem and constraints.',
			'',
			'## Proposal',
			'',
			'Outline the architecture, invariants, and failure modes.',
			'',
			'## Alternatives considered',
			'',
			'- Option A — tradeoffs',
			'- Option B — tradeoffs',
			'',
			'## Rollout & rollback',
			'',
			'- [ ] Feature flag created',
			'- [ ] Observability metrics verified'
		].join('\n')
	},
	{
		id: 'meeting-notes',
		title: 'Meeting notes',
		description: 'Agenda, attendees, discussion notes, and action items.',
		icon: 'calendar',
		markdown: [
			'# Meeting notes',
			'',
			'## Attendees',
			'',
			'- ',
			'',
			'## Agenda',
			'',
			'1. ',
			'',
			'## Decisions & action items',
			'',
			'- [ ] Follow up with owner'
		].join('\n')
	},
	{
		id: 'incident-postmortem',
		title: 'Incident postmortem',
		description: 'Blameless incident timeline, root cause, and corrective actions.',
		icon: 'shield-alert',
		markdown: [
			'# Incident postmortem',
			'',
			'> [!WARNING] Severity: SEV-2 · Impact window: TBD',
			'',
			'## Summary',
			'',
			'What happened and how customers were affected.',
			'',
			'## Timeline',
			'',
			'| Time (UTC) | Event |',
			'| --- | --- |',
			'| 00:00 | Alert triggered |',
			'',
			'## Corrective actions',
			'',
			'- [ ] Prevent recurrence'
		].join('\n')
	},
	{
		id: 'product-spec',
		title: 'Product spec',
		description: 'Problem statement, user journeys, and acceptance gates.',
		icon: 'sparkles',
		markdown: [
			'# Product spec',
			'',
			'## Problem',
			'',
			'Who has this problem and why now.',
			'',
			'## Scope & non-goals',
			'',
			'- In scope: ',
			'- Out of scope: ',
			'',
			'## Acceptance criteria',
			'',
			'- [ ] Keyboard and screen-reader path verified'
		].join('\n')
	},
	{
		id: 'runbook',
		title: 'Ops runbook',
		description: 'Verification commands, recovery steps, and escalation path.',
		icon: 'terminal',
		markdown: [
			'# Ops runbook',
			'',
			'## Preconditions',
			'',
			'```bash',
			'huriro doctor',
			'```',
			'',
			'## Recovery procedure',
			'',
			'1. Check readiness and metrics.',
			'2. Execute verified recovery command.'
		].join('\n')
	}
]

export function getBuiltinDocTemplate(templateId: string): DocTemplate | null {
	return BUILTIN_DOC_TEMPLATES.find((t) => t.id === templateId) ?? null
}
