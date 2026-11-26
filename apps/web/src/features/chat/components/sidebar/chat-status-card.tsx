import type { UserWorkspaceProfileDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { BellOff } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useChatStore } from '../../store/chat-store'

const STATUS_EMOJIS = ['💻', '🌴', '🎯', '🔕', '☕', '🚀'] as const

function isDndActive(dndUntil: string | null | undefined): boolean {
	if (!dndUntil) return false
	const ms = Date.parse(dndUntil)
	return Number.isFinite(ms) && ms > Date.now()
}

export interface ChatStatusCardProps {
	readonly api: TaskApiBridge | null
	readonly myStatus: UserWorkspaceProfileDto | null
}

/** Compact presence/status trigger + popover sitting at the top of the Chat sidebar. */
export function ChatStatusCard({ api, myStatus }: ChatStatusCardProps) {
	const updateMyStatus = useChatStore((s) => s.updateMyStatus)
	const [statusOpen, setStatusOpen] = useState(false)
	const [statusEmoji, setStatusEmoji] = useState('💻')
	const [statusText, setStatusText] = useState('')

	const dndOn = isDndActive(myStatus?.dndUntil)

	function handleOpenChange(next: boolean) {
		if (!api) return
		if (next) {
			setStatusEmoji(myStatus?.statusEmoji ?? '💻')
			setStatusText(myStatus?.statusText ?? '')
		}
		setStatusOpen(next)
	}

	async function handleSaveStatus(ev: FormEvent) {
		ev.preventDefault()
		if (!api) return
		await updateMyStatus(api, {
			statusEmoji: statusEmoji || null,
			statusText: statusText.trim()
		})
		setStatusOpen(false)
	}

	return (
		<div className="px-0.5 pb-1.5">
			<Popover open={statusOpen} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={!api}
						aria-label={t('chat.status.title')}
						className="flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border/70 bg-sidebar-icon-well/65 px-2.5 py-1.5 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent disabled:cursor-default disabled:opacity-70"
					>
						<span className="flex min-w-0 items-center gap-1.5">
							<span aria-hidden className="shrink-0">
								{myStatus?.statusEmoji || '💬'}
							</span>
							<span className="truncate text-sidebar-muted-foreground">
								{myStatus?.statusText || t('chat.status.set')}
							</span>
						</span>
						{dndOn ? (
							<Badge tone="warning" className="shrink-0 px-1.5 py-0 text-[10px]">
								<BellOff className="size-2.5" aria-hidden />
								<span>{t('chat.status.dnd-on')}</span>
							</Badge>
						) : null}
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-72 space-y-3">
					<p className="text-xs font-semibold text-foreground">{t('chat.status.title')}</p>
					<div className="flex flex-wrap gap-1">
						{STATUS_EMOJIS.map((em) => (
							<button
								key={em}
								type="button"
								onClick={() => setStatusEmoji(em)}
								className={`rounded-md border px-2 py-1 text-sm hover:bg-accent ${
									statusEmoji === em ? 'border-primary bg-primary/10' : 'border-border'
								}`}
							>
								{em}
							</button>
						))}
					</div>
					<form onSubmit={(ev) => void handleSaveStatus(ev)} className="space-y-2.5">
						<Input
							value={statusText}
							onChange={(ev) => setStatusText(ev.target.value)}
							placeholder={t('chat.status.placeholder')}
							aria-label={t('chat.status.placeholder')}
							maxLength={200}
						/>
						<div className="flex flex-wrap gap-1.5">
							<Button
								size="sm"
								tone="outline"
								type="button"
								onClick={() => {
									if (!api) return
									void updateMyStatus(api, {
										dndUntil: new Date(Date.now() + 3_600_000).toISOString()
									})
									setStatusOpen(false)
								}}
							>
								{t('chat.status.dnd-1h')}
							</Button>
							<Button
								size="sm"
								tone="outline"
								type="button"
								onClick={() => {
									if (!api) return
									void updateMyStatus(api, {
										dndUntil: new Date(Date.now() + 4 * 3_600_000).toISOString()
									})
									setStatusOpen(false)
								}}
							>
								{t('chat.status.dnd-4h')}
							</Button>
							{dndOn ? (
								<Button
									size="sm"
									tone="ghost"
									type="button"
									onClick={() => {
										if (!api) return
										void updateMyStatus(api, { dndUntil: null })
										setStatusOpen(false)
									}}
								>
									{t('chat.status.dnd-off-action')}
								</Button>
							) : null}
						</div>
						<div className="flex items-center justify-between pt-1">
							<Button
								size="sm"
								tone="ghost"
								type="button"
								onClick={() => {
									if (!api) return
									void updateMyStatus(api, {
										statusEmoji: null,
										statusText: '',
										dndUntil: null
									})
									setStatusOpen(false)
								}}
							>
								{t('chat.status.clear')}
							</Button>
							<Button size="sm" type="submit">
								{t('chat.status.save')}
							</Button>
						</div>
					</form>
				</PopoverContent>
			</Popover>
		</div>
	)
}
