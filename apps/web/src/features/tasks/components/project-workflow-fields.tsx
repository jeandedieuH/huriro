import type { CycleAutoRolloverMode } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface ProjectWorkflowPolicy {
	readonly triageEnabled: boolean
	readonly cycleEnabled: boolean
	readonly cycleDurationDays: number
	readonly cycleCooldownDays: number
	readonly cycleAutoRolloverMode: CycleAutoRolloverMode
	readonly cycleStartWeekday: number
}

export const DEFAULT_PROJECT_WORKFLOW_POLICY: ProjectWorkflowPolicy = {
	triageEnabled: false,
	cycleEnabled: false,
	cycleDurationDays: 14,
	cycleCooldownDays: 0,
	cycleAutoRolloverMode: 'next_cycle',
	cycleStartWeekday: 1
}

export function clampCycleDurationDays(value: number): number {
	if (!Number.isFinite(value)) return 14
	return Math.min(90, Math.max(1, Math.trunc(value)))
}

export function clampCycleCooldownDays(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.min(30, Math.max(0, Math.trunc(value)))
}

export interface ProjectWorkflowFieldsProps {
	readonly idPrefix: string
	readonly value: ProjectWorkflowPolicy
	readonly disabled?: boolean | undefined
	readonly onChange: (patch: Partial<ProjectWorkflowPolicy>) => void
}

const ROLLOVER_MODES: readonly CycleAutoRolloverMode[] = ['next_cycle', 'backlog', 'none']
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

/**
 * Shared triage + cycles policy controls reused by CreateProjectDialog and
 * ProjectSettingsDialog so workflow configuration stays consistent.
 */
export function ProjectWorkflowFields({
	idPrefix,
	value,
	disabled = false,
	onChange
}: ProjectWorkflowFieldsProps) {
	const triageId = `${idPrefix}-triage`
	const cycleId = `${idPrefix}-cycle`
	const durationId = `${idPrefix}-cycle-duration`
	const cooldownId = `${idPrefix}-cycle-cooldown`

	return (
		<div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{t('tasks.project.workflow')}
			</p>

			<div className="flex items-start gap-2.5">
				<Checkbox
					id={triageId}
					checked={value.triageEnabled}
					disabled={disabled}
					onCheckedChange={(next) => onChange({ triageEnabled: next === true })}
					className="mt-0.5"
				/>
				<div className="space-y-0.5">
					<label htmlFor={triageId} className="text-xs font-medium leading-none">
						{t('tasks.project.triage-enabled')}
					</label>
					<p className="text-xs text-muted-foreground">{t('tasks.project.triage-hint')}</p>
				</div>
			</div>

			<div className="flex items-start gap-2.5">
				<Checkbox
					id={cycleId}
					checked={value.cycleEnabled}
					disabled={disabled}
					onCheckedChange={(next) => onChange({ cycleEnabled: next === true })}
					className="mt-0.5"
				/>
				<div className="space-y-0.5">
					<label htmlFor={cycleId} className="text-xs font-medium leading-none">
						{t('tasks.project.cycle-enabled')}
					</label>
					<p className="text-xs text-muted-foreground">{t('tasks.project.cycle-hint')}</p>
				</div>
			</div>

			{value.cycleEnabled ? (
				<div className="grid grid-cols-2 gap-2.5 pt-1">
					<div className="space-y-1">
						<label htmlFor={durationId} className="text-xs font-medium">
							{t('tasks.project.cycle-duration')}
						</label>
						<Input
							id={durationId}
							type="number"
							min={1}
							max={90}
							disabled={disabled}
							value={value.cycleDurationDays}
							onChange={(ev) =>
								onChange({ cycleDurationDays: clampCycleDurationDays(Number(ev.target.value)) })
							}
							className="h-8 text-xs"
						/>
					</div>

					<div className="space-y-1">
						<label htmlFor={cooldownId} className="text-xs font-medium">
							{t('tasks.project.cycle-cooldown')}
						</label>
						<Input
							id={cooldownId}
							type="number"
							min={0}
							max={30}
							disabled={disabled}
							value={value.cycleCooldownDays}
							onChange={(ev) =>
								onChange({ cycleCooldownDays: clampCycleCooldownDays(Number(ev.target.value)) })
							}
							className="h-8 text-xs"
						/>
					</div>

					<div className="space-y-1">
						<span className="text-xs font-medium">{t('tasks.project.cycle-rollover')}</span>
						<Select
							value={value.cycleAutoRolloverMode}
							disabled={disabled}
							onValueChange={(next) => onChange({ cycleAutoRolloverMode: next as CycleAutoRolloverMode })}
						>
							<SelectTrigger aria-label={t('tasks.project.cycle-rollover')} className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ROLLOVER_MODES.map((mode) => (
									<SelectItem key={mode} value={mode}>
										{t(`tasks.project.cycle-rollover.${mode}` as never)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1">
						<span className="text-xs font-medium">{t('tasks.project.cycle-start-weekday')}</span>
						<Select
							value={String(value.cycleStartWeekday)}
							disabled={disabled}
							onValueChange={(next) => onChange({ cycleStartWeekday: Number(next) })}
						>
							<SelectTrigger aria-label={t('tasks.project.cycle-start-weekday')} className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{WEEKDAYS.map((day) => (
									<SelectItem key={day} value={String(day)}>
										{t(`tasks.project.weekday.${day}` as never)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			) : null}
		</div>
	)
}
