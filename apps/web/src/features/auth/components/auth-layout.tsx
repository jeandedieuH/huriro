import { t } from '@huriro/i18n'
import { FileText, Moon, ShieldCheck, Sun, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

export interface AuthLayoutProps {
	readonly title: string
	readonly subtitle: string
	readonly wide?: boolean | undefined
	readonly footer?: ReactNode | undefined
	readonly onUsePreview?: (() => void) | undefined
	readonly children: ReactNode
}

/**
 * Split-screen editorial auth shell built strictly on Huriro semantic tokens
 * (light + `.dark` themes) with an architectural showcase rail on desktop.
 */
export function AuthLayout({
	title,
	subtitle,
	wide = false,
	footer,
	onUsePreview,
	children
}: AuthLayoutProps) {
	const theme = useUiStore((s) => s.theme)
	const toggleTheme = useUiStore((s) => s.toggleTheme)

	return (
		<div className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
			{/* Desktop editorial showcase panel */}
			<aside
				aria-label={t('app.name')}
				className="relative hidden flex-col justify-between overflow-hidden border-e border-border bg-surface-2 p-10 xl:p-14 lg:flex"
				style={{
					backgroundImage:
						'radial-gradient(color-mix(in oklch, var(--border) 80%, transparent) 1px, transparent 1px)',
					backgroundSize: '20px 20px'
				}}
			>
				{/* Subtle semantic ambient glow */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -top-24 -start-24 size-96 rounded-full bg-primary/10 blur-3xl"
				/>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -bottom-24 -end-24 size-80 rounded-full bg-(--info)/10 blur-3xl"
				/>

				<div className="relative z-10 flex items-center justify-between gap-4">
					<div className="flex items-center">
						<img src="/images/logo.png" alt={t('app.name')} className="h-10 w-auto dark:hidden" />
						<img src="/images/logo-white.png" alt={t('app.name')} className="hidden h-10 w-auto dark:block" />
					</div>
					<Badge tone="outline" className="bg-card/80 backdrop-blur-xs">
						{t('auth.showcase.badge')}
					</Badge>
				</div>

				<div className="relative z-10 my-auto flex max-w-lg flex-col gap-6 py-8">
					<div className="space-y-3">
						<p className="text-3xl font-semibold tracking-tight text-foreground">
							{t('auth.showcase.headline')}
						</p>
						<p className="text-sm leading-relaxed text-muted-foreground">{t('auth.showcase.subcopy')}</p>
					</div>

					<div className="flex flex-col gap-3 rounded-xl border border-border bg-card/85 p-5 shadow-(--shadow-3) backdrop-blur-sm">
						<div className="flex items-start gap-3">
							<span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<Zap className="size-4" aria-hidden />
							</span>
							<div className="min-w-0 flex-1 space-y-0.5">
								<div className="flex items-center justify-between gap-2">
									<p className="text-sm font-medium text-foreground">
										{t('auth.showcase.feature-sync.title')}
									</p>
									<span className="hidden items-center gap-0.5 sm:inline-flex">
										<Kbd>⌘</Kbd>
										<Kbd>K</Kbd>
									</span>
								</div>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{t('auth.showcase.feature-sync.desc')}
								</p>
							</div>
						</div>

						<div className="h-px bg-border" />

						<div className="flex items-start gap-3">
							<span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--info)/12 text-(--info)">
								<FileText className="size-4" aria-hidden />
							</span>
							<div className="min-w-0 flex-1 space-y-0.5">
								<div className="flex items-center justify-between gap-2">
									<p className="text-sm font-medium text-foreground">
										{t('auth.showcase.feature-docs.title')}
									</p>
									<Kbd className="hidden sm:inline-flex">C</Kbd>
								</div>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{t('auth.showcase.feature-docs.desc')}
								</p>
							</div>
						</div>

						<div className="h-px bg-border" />

						<div className="flex items-start gap-3">
							<span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--success)/12 text-(--success)">
								<ShieldCheck className="size-4" aria-hidden />
							</span>
							<div className="min-w-0 flex-1 space-y-0.5">
								<p className="text-sm font-medium text-foreground">
									{t('auth.showcase.feature-security.title')}
								</p>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{t('auth.showcase.feature-security.desc')}
								</p>
							</div>
						</div>
					</div>
				</div>

				<div className="relative z-10 flex items-center justify-between text-xs text-muted-foreground">
					<span>{t('auth.showcase.footer')}</span>
				</div>
			</aside>

			{/* Primary auth & onboarding column */}
			<div className="flex min-h-dvh flex-col bg-background">
				<header className="flex items-center justify-between px-5 py-4 sm:px-8">
					<div className="flex items-center lg:hidden">
						<img src="/images/logo.png" alt={t('app.name')} className="h-8 w-auto dark:hidden" />
						<img src="/images/logo-white.png" alt={t('app.name')} className="hidden h-8 w-auto dark:block" />
					</div>
					<div className="ms-auto">
						<Button
							type="button"
							size="icon"
							tone="ghost"
							className="size-8"
							aria-label={t('shell.theme-toggle')}
							onClick={toggleTheme}
						>
							{theme === 'dark' ? (
								<Sun className="size-4" aria-hidden />
							) : (
								<Moon className="size-4" aria-hidden />
							)}
						</Button>
					</div>
				</header>

				<main className="flex flex-1 items-center justify-center px-5 pb-10 pt-2 sm:px-10">
					<div className={cn('flex w-full flex-col gap-5', wide ? 'max-w-[490px]' : 'max-w-[420px]')}>
						<div className="space-y-1.5">
							<h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
							<p className="text-sm text-muted-foreground">{subtitle}</p>
						</div>

						<div className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-(--shadow-2) sm:p-7">
							{children}
						</div>

						{footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}

						{onUsePreview ? (
							<div className="flex justify-center pt-1">
								<button
									type="button"
									className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
									onClick={onUsePreview}
								>
									{t('auth.continue-offline')}
								</button>
							</div>
						) : null}
					</div>
				</main>
			</div>
		</div>
	)
}
