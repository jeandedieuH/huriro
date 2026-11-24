import { t } from '@huriro/i18n'
import { Check, Keyboard, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { type DisplayDensity, type ThemeMode, useUiStore } from '@/stores/ui-store'
import { SettingsCard, SettingsCardBody, SettingsCardHeader, SettingsRow } from './settings-primitives'

export function AppearanceSettingsPanel() {
	const theme = useUiStore((s) => s.theme)
	const setTheme = useUiStore((s) => s.setTheme)
	const density = useUiStore((s) => s.density)
	const setDensity = useUiStore((s) => s.setDensity)
	const shortcutsEnabled = useUiStore((s) => s.shortcutsEnabled)
	const setShortcutsEnabled = useUiStore((s) => s.setShortcutsEnabled)
	const setShortcutsDialogOpen = useUiStore((s) => s.setShortcutsDialogOpen)

	const themeOptions: readonly {
		readonly id: ThemeMode
		readonly title: string
		readonly desc: string
		readonly icon: typeof Sun
	}[] = [
		{
			id: 'light',
			title: t('settings.appearance.theme-light'),
			desc: t('settings.appearance.theme-light-desc'),
			icon: Sun
		},
		{
			id: 'dark',
			title: t('settings.appearance.theme-dark'),
			desc: t('settings.appearance.theme-dark-desc'),
			icon: Moon
		}
	]

	const densityOptions: readonly {
		readonly id: DisplayDensity
		readonly title: string
		readonly desc: string
		readonly gapClass: string
		readonly rowHeightClass: string
	}[] = [
		{
			id: 'comfortable',
			title: t('tasks.density.comfortable'),
			desc: t('settings.appearance.density-comfortable-desc'),
			gapClass: 'gap-2',
			rowHeightClass: 'h-3'
		},
		{
			id: 'compact',
			title: t('tasks.density.compact'),
			desc: t('settings.appearance.density-compact-desc'),
			gapClass: 'gap-1',
			rowHeightClass: 'h-2'
		}
	]

	return (
		<div className="space-y-5">
			<SettingsCard labelledBy="appearance-theme-heading">
				<SettingsCardHeader
					headingId="appearance-theme-heading"
					icon={<Palette className="size-4" />}
					title={t('settings.appearance.theme-title')}
					description={t('settings.appearance.theme-desc')}
				/>
				<SettingsCardBody>
					<div className="grid gap-3 sm:grid-cols-2">
						{themeOptions.map((option) => {
							const active = theme === option.id
							const Icon = option.icon
							return (
								<button
									key={option.id}
									type="button"
									aria-pressed={active}
									onClick={() => setTheme(option.id)}
									className={cn(
										'group flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors duration-(--motion-duration-fast)',
										active
											? 'border-primary bg-primary/5 ring-1 ring-primary/30'
											: 'border-border bg-surface-2/40 hover:bg-accent/50'
									)}
								>
									{/* Miniature theme surface preview */}
									<div
										aria-hidden
										className={cn(
											'flex h-20 w-full overflow-hidden rounded-lg border',
											option.id === 'dark'
												? 'border-border bg-foreground/90 text-background'
												: 'border-border bg-background text-foreground'
										)}
									>
										<div
											className={cn(
												'w-12 shrink-0 border-r p-2 space-y-1.5',
												option.id === 'dark'
													? 'border-background/15 bg-foreground/80'
													: 'border-border bg-surface-2'
											)}
										>
											<span className="block h-1.5 w-6 rounded-full bg-primary" />
											<span className="block h-1.5 w-7 rounded-full bg-muted-foreground/30" />
											<span className="block h-1.5 w-5 rounded-full bg-muted-foreground/20" />
										</div>
										<div className="flex flex-1 flex-col justify-center gap-1.5 p-2.5">
											<span className="block h-2 w-20 rounded-full bg-current opacity-20" />
											<span className="block h-2 w-28 rounded-full bg-current opacity-10" />
											<span className="block h-2 w-16 rounded-full bg-primary/50" />
										</div>
									</div>

									<div className="flex items-start justify-between gap-2">
										<div className="space-y-0.5">
											<div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
												<Icon className="size-4 text-muted-foreground" aria-hidden />
												<span>{option.title}</span>
											</div>
											<p className="text-xs leading-relaxed text-muted-foreground">{option.desc}</p>
										</div>
										{active ? (
											<Badge tone="default" className="shrink-0">
												<Check className="size-3" aria-hidden />
												<span>{t('settings.appearance.active')}</span>
											</Badge>
										) : null}
									</div>
								</button>
							)
						})}
					</div>
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="appearance-density-heading">
				<SettingsCardHeader
					headingId="appearance-density-heading"
					icon={<SlidersHorizontal className="size-4" />}
					title={t('settings.appearance.density-title')}
					description={t('settings.appearance.density-desc')}
				/>
				<SettingsCardBody>
					<div className="grid gap-3 sm:grid-cols-2">
						{densityOptions.map((option) => {
							const active = density === option.id
							return (
								<button
									key={option.id}
									type="button"
									aria-pressed={active}
									onClick={() => setDensity(option.id)}
									className={cn(
										'flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors duration-(--motion-duration-fast)',
										active
											? 'border-primary bg-primary/5 ring-1 ring-primary/30'
											: 'border-border bg-surface-2/40 hover:bg-accent/50'
									)}
								>
									<div
										aria-hidden
										className={cn(
											'flex flex-col justify-center rounded-lg border border-border bg-background p-3',
											option.gapClass
										)}
									>
										<div className={cn('w-full rounded bg-muted', option.rowHeightClass)} />
										<div className={cn('w-5/6 rounded bg-muted', option.rowHeightClass)} />
										<div className={cn('w-2/3 rounded bg-muted', option.rowHeightClass)} />
									</div>

									<div className="flex items-start justify-between gap-2">
										<div className="space-y-0.5">
											<span className="block text-sm font-semibold text-foreground">{option.title}</span>
											<p className="text-xs leading-relaxed text-muted-foreground">{option.desc}</p>
										</div>
										{active ? (
											<Badge tone="default" className="shrink-0">
												<Check className="size-3" aria-hidden />
												<span>{t('settings.appearance.active')}</span>
											</Badge>
										) : null}
									</div>
								</button>
							)
						})}
					</div>
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="appearance-keyboard-heading">
				<SettingsCardHeader
					headingId="appearance-keyboard-heading"
					icon={<Keyboard className="size-4" />}
					title={t('settings.appearance.keyboard-title')}
					description={t('settings.appearance.keyboard-desc')}
				/>
				<SettingsCardBody className="divide-y divide-border/70">
					<SettingsRow label={t('shortcuts.enable')} htmlFor="settings-shortcuts-enabled">
						<Checkbox
							id="settings-shortcuts-enabled"
							checked={shortcutsEnabled}
							onCheckedChange={(checked) => setShortcutsEnabled(checked === true)}
						/>
					</SettingsRow>
					<SettingsRow label={t('shortcuts.title')}>
						<div className="flex items-center gap-2">
							<Kbd>?</Kbd>
							<Button type="button" size="sm" tone="outline" onClick={() => setShortcutsDialogOpen(true)}>
								{t('settings.appearance.shortcuts-view')}
							</Button>
						</div>
					</SettingsRow>
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
