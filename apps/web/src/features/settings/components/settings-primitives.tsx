import { t } from '@huriro/i18n'
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Copy, Info, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface SettingsCardProps {
	readonly children: ReactNode
	readonly tone?: 'default' | 'danger' | undefined
	readonly labelledBy?: string | undefined
	readonly className?: string | undefined
}

/** Canonical container card for settings panels using Huriro semantic surfaces. */
export function SettingsCard({ children, tone = 'default', labelledBy, className }: SettingsCardProps) {
	return (
		<section
			aria-labelledby={labelledBy}
			className={cn(
				'overflow-hidden rounded-xl border bg-card text-card-foreground shadow-(--shadow-1)',
				tone === 'danger' ? 'border-destructive/40 bg-destructive/[0.03]' : 'border-border',
				className
			)}
		>
			{children}
		</section>
	)
}

export interface SettingsCardHeaderProps {
	readonly title: string
	readonly description?: string | undefined
	readonly icon?: ReactNode | undefined
	readonly badge?: ReactNode | undefined
	readonly action?: ReactNode | undefined
	readonly headingId?: string | undefined
	readonly headingLevel?: 2 | 3 | undefined
	readonly tone?: 'default' | 'danger' | undefined
}

export function SettingsCardHeader({
	title,
	description,
	icon,
	badge,
	action,
	headingId,
	headingLevel = 2,
	tone = 'default'
}: SettingsCardHeaderProps) {
	const HeadingTag = headingLevel === 3 ? 'h3' : 'h2'

	return (
		<div
			className={cn(
				'flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4',
				tone === 'danger' ? 'border-destructive/25' : 'border-border/70'
			)}
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				{icon ? (
					<span
						aria-hidden
						className={cn(
							'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border',
							tone === 'danger'
								? 'border-destructive/30 bg-destructive/10 text-destructive'
								: 'border-border/80 bg-surface-2 text-muted-foreground'
						)}
					>
						{icon}
					</span>
				) : null}
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<HeadingTag
							id={headingId}
							className={cn(
								'text-sm font-semibold tracking-tight',
								tone === 'danger' ? 'text-destructive' : 'text-card-foreground'
							)}
						>
							{title}
						</HeadingTag>
						{badge}
					</div>
					{description ? (
						<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
					) : null}
				</div>
			</div>
			{action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
		</div>
	)
}

export function SettingsCardBody({
	children,
	className
}: {
	readonly children: ReactNode
	readonly className?: string | undefined
}) {
	return <div className={cn('space-y-4 p-5', className)}>{children}</div>
}

export function SettingsCardFooter({
	children,
	className
}: {
	readonly children: ReactNode
	readonly className?: string | undefined
}) {
	return (
		<div
			className={cn(
				'flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-surface-2/60 px-5 py-3',
				className
			)}
		>
			{children}
		</div>
	)
}

export interface SettingsRowProps {
	readonly label: ReactNode
	readonly description?: ReactNode | undefined
	readonly htmlFor?: string | undefined
	readonly children: ReactNode
	readonly className?: string | undefined
}

/** Responsive split row aligning label/description on the left and control on the right. */
export function SettingsRow({ label, description, htmlFor, children, className }: SettingsRowProps) {
	return (
		<div
			className={cn(
				'flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between',
				className
			)}
		>
			<div className="min-w-0 flex-1 space-y-0.5">
				{htmlFor ? (
					<label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
						{label}
					</label>
				) : (
					<div className="text-sm font-medium text-foreground">{label}</div>
				)}
				{description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
			</div>
			<div className="shrink-0 sm:max-w-xs">{children}</div>
		</div>
	)
}

export interface SettingsNoticeProps {
	readonly tone?: 'info' | 'success' | 'warning' | 'danger' | undefined
	readonly title?: string | undefined
	readonly children?: ReactNode | undefined
	readonly action?: ReactNode | undefined
	readonly onDismiss?: (() => void) | undefined
	readonly className?: string | undefined
}

const NOTICE_STYLES = {
	info: 'border-(--info)/35 bg-(--info)/10 text-foreground',
	success: 'border-(--success)/35 bg-(--success)/10 text-foreground',
	warning: 'border-(--warning)/40 bg-(--warning)/10 text-foreground',
	danger: 'border-destructive/40 bg-destructive/10 text-destructive'
} as const

export function SettingsNotice({
	tone = 'info',
	title,
	children,
	action,
	onDismiss,
	className
}: SettingsNoticeProps) {
	const Icon =
		tone === 'danger'
			? AlertCircle
			: tone === 'warning'
				? AlertTriangle
				: tone === 'success'
					? CheckCircle2
					: Info

	const iconColor =
		tone === 'danger'
			? 'text-destructive'
			: tone === 'warning'
				? 'text-(--warning)'
				: tone === 'success'
					? 'text-(--success)'
					: 'text-(--info)'

	return (
		<div
			role={tone === 'danger' ? 'alert' : 'status'}
			className={cn(
				'flex items-start gap-3 rounded-lg border px-4 py-3 text-xs',
				NOTICE_STYLES[tone],
				className
			)}
		>
			<Icon className={cn('mt-0.5 size-4 shrink-0', iconColor)} aria-hidden />
			<div className="min-w-0 flex-1 space-y-1">
				{title ? <p className="font-semibold text-foreground">{title}</p> : null}
				{children ? <div className="leading-relaxed">{children}</div> : null}
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
			{onDismiss ? (
				<Button
					type="button"
					size="icon"
					tone="ghost"
					className="size-6 shrink-0"
					aria-label={t('settings.common.dismiss')}
					onClick={onDismiss}
				>
					<X className="size-3.5" aria-hidden />
				</Button>
			) : null}
		</div>
	)
}

export interface CopyableSecretFieldProps {
	readonly value: string
	readonly label?: string | undefined
	readonly className?: string | undefined
}

/** Monospace code/secret display with one-click clipboard copy and polite confirmation. */
export function CopyableSecretField({ value, label, className }: CopyableSecretFieldProps) {
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 2000)
		return () => clearTimeout(timer)
	}, [copied])

	async function handleCopy() {
		try {
			await navigator.clipboard?.writeText(value)
			setCopied(true)
		} catch {
			setCopied(false)
		}
	}

	return (
		<div
			className={cn(
				'flex items-center justify-between gap-2 rounded-md border border-border bg-background/80 px-2.5 py-1.5',
				className
			)}
		>
			<code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{value}</code>
			<Button
				type="button"
				size="sm"
				tone="ghost"
				className="h-6 shrink-0 gap-1 px-2 text-xs"
				aria-label={label ?? t('settings.common.copy')}
				onClick={() => void handleCopy()}
			>
				{copied ? (
					<>
						<Check className="size-3 text-(--success)" aria-hidden />
						<span>{t('settings.common.copied')}</span>
					</>
				) : (
					<>
						<Copy className="size-3" aria-hidden />
						<span>{t('settings.common.copy')}</span>
					</>
				)}
			</Button>
			<span className="sr-only" aria-live="polite">
				{copied ? t('settings.common.copied') : ''}
			</span>
		</div>
	)
}

export function SettingsSkeleton({ rows = 2 }: { readonly rows?: number | undefined }) {
	return (
		<div className="overflow-hidden rounded-xl border border-border bg-card shadow-(--shadow-1)">
			<div className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
				<Skeleton className="size-8 rounded-lg" />
				<div className="space-y-1.5">
					<Skeleton className="h-4 w-44" />
					<Skeleton className="h-3 w-72" />
				</div>
			</div>
			<div className="space-y-3 p-5">
				{Array.from({ length: rows }).map((_, idx) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder rows never reorder
					<Skeleton key={idx} className="h-12 w-full rounded-lg" />
				))}
			</div>
		</div>
	)
}

export interface SettingsEmptyStateProps {
	readonly icon?: ReactNode | undefined
	readonly message: string
	readonly action?: ReactNode | undefined
}

export function SettingsEmptyState({ icon, message, action }: SettingsEmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-2/40 px-4 py-7 text-center">
			{icon ? (
				<span
					aria-hidden
					className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground"
				>
					{icon}
				</span>
			) : null}
			<p className="max-w-md text-xs leading-relaxed text-muted-foreground">{message}</p>
			{action ? <div className="pt-1">{action}</div> : null}
		</div>
	)
}
