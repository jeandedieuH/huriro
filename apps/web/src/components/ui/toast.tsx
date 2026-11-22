import { t } from '@huriro/i18n'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ToastTone = 'default' | 'success' | 'warning' | 'danger'

export interface ToastItem {
	readonly id: string
	readonly title: string
	readonly description?: string | undefined
	readonly tone?: ToastTone | undefined
	readonly actionLabel?: string | undefined
	readonly onAction?: (() => void) | undefined
}

const TONE_CLASS: Record<ToastTone, string> = {
	default: 'border-border bg-popover text-popover-foreground',
	success: 'border-(--success)/40 bg-popover text-popover-foreground',
	warning: 'border-(--warning)/40 bg-popover text-popover-foreground',
	danger: 'border-destructive/40 bg-popover text-destructive'
}

export interface ToasterProps {
	readonly toasts: readonly ToastItem[]
	readonly onDismiss: (id: string) => void
}

/** Lightweight accessible toast stack (§17.8 — 5s auto-dismiss with optional Undo). */
export function Toaster({ toasts, onDismiss }: ToasterProps) {
	if (toasts.length === 0) return null

	return (
		<section
			aria-label={t('inbox.title')}
			className="fixed right-4 bottom-4 z-(--z-toast) flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
		>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					role={toast.tone === 'danger' ? 'alert' : 'status'}
					className={cn(
						'flex items-start justify-between gap-2 rounded-lg border p-3 shadow-(--shadow-3)',
						TONE_CLASS[toast.tone ?? 'default']
					)}
				>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium leading-ui">{toast.title}</p>
						{toast.description ? (
							<p className="mt-0.5 text-xs text-muted-foreground">{toast.description}</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						{toast.actionLabel && toast.onAction ? (
							<Button
								size="sm"
								tone="ghost"
								onClick={() => {
									toast.onAction?.()
									onDismiss(toast.id)
								}}
							>
								{toast.actionLabel}
							</Button>
						) : null}
						<Button
							size="icon"
							tone="ghost"
							className="size-7"
							aria-label={t('common.close')}
							onClick={() => onDismiss(toast.id)}
						>
							<X className="size-3.5" aria-hidden />
						</Button>
					</div>
				</div>
			))}
		</section>
	)
}
