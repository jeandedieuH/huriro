import { t } from '@huriro/i18n'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parse yyyy-mm-dd as a calendar date in local time; `new Date(string)` would be UTC and can shift the visible day. */
export function parseDatePickerValue(value: string): Date | undefined {
	const match = ISO_DATE_PATTERN.exec(value.trim())
	if (!match) return undefined
	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const date = new Date(year, month - 1, day)
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
	return date
}

/** Serialize using calendar fields rather than `toISOString()` so the selected day never crosses a timezone boundary. */
export function formatDatePickerValue(date: Date): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

export interface DatePickerProps {
	readonly id?: string | undefined
	readonly name?: string | undefined
	readonly value: string
	readonly onChange: (value: string) => void
	readonly placeholder?: string | undefined
	readonly disabled?: boolean | undefined
	readonly invalid?: boolean | undefined
	readonly clearable?: boolean | undefined
	readonly className?: string | undefined
	readonly contentClassName?: string | undefined
	readonly startMonth?: Date | undefined
	readonly endMonth?: Date | undefined
}

export function DatePicker({
	id,
	name,
	value,
	onChange,
	placeholder,
	disabled,
	invalid,
	clearable = true,
	className,
	contentClassName,
	startMonth,
	endMonth
}: DatePickerProps) {
	const [open, setOpen] = useState(false)
	const selectedDate = useMemo(() => parseDatePickerValue(value), [value])
	const displayValue = useMemo(
		() =>
			selectedDate ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(selectedDate) : '',
		[selectedDate]
	)
	const navigationMonths = useMemo(() => {
		const currentYear = new Date().getFullYear()
		return {
			start: startMonth ?? new Date(currentYear - 5, 0, 1),
			end: endMonth ?? new Date(currentYear + 10, 11, 31)
		}
	}, [startMonth, endMonth])

	function selectToday() {
		onChange(formatDatePickerValue(new Date()))
		setOpen(false)
	}

	function clearSelection() {
		onChange('')
		setOpen(false)
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			{name ? <input type="hidden" name={name} value={value} /> : null}
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					tone="outline"
					disabled={disabled}
					aria-invalid={invalid || undefined}
					className={cn(
						'h-8 w-full justify-start gap-2 px-2.5 text-xs font-normal shadow-(--shadow-1)',
						!selectedDate && 'text-muted-foreground',
						invalid && 'border-destructive focus-visible:border-destructive',
						className
					)}
				>
					<CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
					<span className="min-w-0 flex-1 truncate text-left">
						{displayValue || placeholder || t('common.date-picker.placeholder')}
					</span>
					<ChevronDown
						className={cn(
							'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--motion-duration-fast)',
							open && 'rotate-180'
						)}
						aria-hidden
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={6}
				aria-label={t('common.date-picker.dialog-label')}
				className={cn('w-auto overflow-hidden rounded-xl p-0', contentClassName)}
			>
				<Calendar
					mode="single"
					autoFocus
					{...(selectedDate ? { selected: selectedDate, defaultMonth: selectedDate } : {})}
					startMonth={navigationMonths.start}
					endMonth={navigationMonths.end}
					onSelect={(date) => {
						onChange(date ? formatDatePickerValue(date) : '')
						if (date) setOpen(false)
					}}
					className="border-0 bg-transparent"
				/>
				<div className="flex items-center justify-between border-t border-border/80 px-2 py-1.5">
					{clearable ? (
						<Button
							type="button"
							tone="ghost"
							size="sm"
							className="h-7 px-2 text-xs"
							disabled={!selectedDate}
							onClick={clearSelection}
						>
							{t('common.date-picker.clear')}
						</Button>
					) : null}
					<Button
						type="button"
						tone="ghost"
						size="sm"
						className={cn('h-7 px-2 text-xs', !clearable && 'ml-auto')}
						onClick={selectToday}
					>
						{t('common.date-picker.today')}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	)
}
