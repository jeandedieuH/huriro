import type { ProjectStatusDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import {
	AlertOctagon,
	ArrowDown,
	ArrowUp,
	CheckCircle2,
	Circle,
	CircleDashed,
	CircleDot,
	Minus,
	XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const PRIORITY_META: Record<
	number,
	{ labelId: MessageId; tone: 'outline' | 'secondary' | 'info' | 'warning' | 'danger' }
> = {
	0: { labelId: 'tasks.priority.0', tone: 'outline' },
	1: { labelId: 'tasks.priority.1', tone: 'secondary' },
	2: { labelId: 'tasks.priority.2', tone: 'info' },
	3: { labelId: 'tasks.priority.3', tone: 'warning' },
	4: { labelId: 'tasks.priority.4', tone: 'danger' }
}

/** Icon + label always (§17.10 — never encode status or priority by color alone). */
export function PriorityBadge({ priority }: { readonly priority: number }) {
	const meta = PRIORITY_META[priority] ?? {
		labelId: 'tasks.priority.0' as MessageId,
		tone: 'outline' as const
	}
	return (
		<Badge tone={meta.tone} className="shrink-0">
			{priority === 4 ? (
				<AlertOctagon className="size-3" aria-hidden />
			) : priority === 3 ? (
				<ArrowUp className="size-3" aria-hidden />
			) : priority === 2 ? (
				<Minus className="size-3" aria-hidden />
			) : priority === 1 ? (
				<ArrowDown className="size-3" aria-hidden />
			) : (
				<CircleDashed className="size-3" aria-hidden />
			)}
			<span>{t(meta.labelId)}</span>
		</Badge>
	)
}

const STATUS_TONE: Record<
	ProjectStatusDto['category'],
	'outline' | 'info' | 'warning' | 'success' | 'danger'
> = {
	backlog: 'outline',
	unstarted: 'info',
	started: 'warning',
	completed: 'success',
	cancelled: 'danger'
}

export function StatusIcon({ category }: { readonly category: ProjectStatusDto['category'] }) {
	switch (category) {
		case 'backlog':
			return <CircleDashed className="size-3.5 text-muted-foreground" aria-hidden />
		case 'unstarted':
			return <Circle className="size-3.5 text-info" aria-hidden />
		case 'started':
			return <CircleDot className="size-3.5 text-warning" aria-hidden />
		case 'completed':
			return <CheckCircle2 className="size-3.5 text-success" aria-hidden />
		case 'cancelled':
			return <XCircle className="size-3.5 text-destructive" aria-hidden />
	}
}

export function StatusBadge({ status }: { readonly status: ProjectStatusDto | undefined }) {
	if (!status) {
		return (
			<Badge tone="outline">
				<CircleDashed className="size-3" aria-hidden />
				<span>—</span>
			</Badge>
		)
	}
	return (
		<Badge tone={STATUS_TONE[status.category]} className="shrink-0">
			<StatusIcon category={status.category} />
			<span>{status.name}</span>
		</Badge>
	)
}
