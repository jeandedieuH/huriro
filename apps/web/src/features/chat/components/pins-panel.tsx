import type { ChatPinnedMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Pin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface PinsPanelProps {
	readonly pins: readonly ChatPinnedMessageDto[]
	readonly displayNameFor: (userId: string) => string
	readonly onJumpToMessage?: ((messageId: string) => void) | undefined
	readonly onUnpin: (messageId: string) => Promise<void>
	readonly onClose: () => void
}

/**
 * Slack-style pinned-items side panel for a channel. Purely presentational —
 * data loading and mutations live in the chat store so the panel can be
 * rendered in storybook/tests without network access.
 */
export function PinsPanel({ pins, displayNameFor, onJumpToMessage, onUnpin, onClose }: PinsPanelProps) {
	return (
		<aside
			className="flex w-80 flex-col border-l border-border bg-background"
			data-testid="pins-panel"
			aria-label={t('chat.pins.title')}
		>
			<header className="flex items-center justify-between border-b border-border px-4 py-3">
				<div className="flex items-center gap-2">
					<Pin className="size-4 text-muted-foreground" aria-hidden />
					<h2 className="text-sm font-semibold">{t('chat.pins.title')}</h2>
				</div>
				<Button tone="ghost" size="icon" aria-label={t('chat.pins.close')} onClick={onClose}>
					<X className="size-4" aria-hidden />
				</Button>
			</header>
			<div className="flex-1 overflow-y-auto">
				{pins.length === 0 ? (
					<p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('chat.pins.empty')}</p>
				) : (
					<ul className="divide-y divide-border">
						{pins.map((pin) => (
							<li key={pin.messageId} className="group px-4 py-3">
								<button
									type="button"
									className="block w-full text-left"
									onClick={() => onJumpToMessage?.(pin.messageId)}
								>
									<p className="line-clamp-3 text-sm text-foreground">{pin.bodyText}</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{displayNameFor(pin.authorId)} · {t('chat.pins.pinned-by')} {displayNameFor(pin.pinnedBy)}
									</p>
								</button>
								<div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
									<Button
										tone="ghost"
										size="sm"
										className="focus-visible:opacity-100"
										onClick={() => {
											void onUnpin(pin.messageId)
										}}
									>
										{t('chat.message.unpin')}
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</aside>
	)
}
