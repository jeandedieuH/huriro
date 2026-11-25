import { t } from '@huriro/i18n'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import type { ChangeEvent, ComponentProps } from 'react'
import {
	type ChevronProps,
	DayPicker,
	type DropdownProps,
	getDefaultClassNames,
	UI,
	useDayPicker
} from 'react-day-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type CalendarProps = ComponentProps<typeof DayPicker>

function formatMonthYear(date: Date) {
	return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)
}

function CalendarChevron({ className, orientation, disabled: _disabled, size = 16, ...props }: ChevronProps) {
	const Icon =
		orientation === 'left'
			? ChevronLeft
			: orientation === 'right'
				? ChevronRight
				: orientation === 'up'
					? ChevronUp
					: ChevronDown
	return <Icon aria-hidden className={cn('size-4', className)} size={size} {...props} />
}

function CalendarDropdown({ options, className, value, disabled, onChange, ...props }: DropdownProps) {
	const { classNames, styles } = useDayPicker()
	const ariaLabel = props['aria-label']
	const stringValue = value === undefined || value === null ? undefined : String(value)
	const selectedLabel = options?.find((option) => String(option.value) === stringValue)?.label
	const accessibleLabel = [selectedLabel, ariaLabel].filter(Boolean).join(', ')
	const isYearDropdown = (options?.length ?? 0) > 12

	function emitChange(nextValue: string) {
		// react-day-picker's navigation callbacks only read `event.target.value`; adapt Radix's string callback to that contract.
		onChange?.({ target: { value: nextValue } } as ChangeEvent<HTMLSelectElement>)
	}

	return (
		<span
			data-disabled={disabled || undefined}
			className={cn(classNames[UI.DropdownRoot], className)}
			style={styles?.[UI.DropdownRoot]}
		>
			<Select
				{...(stringValue ? { value: stringValue } : {})}
				{...(disabled !== undefined ? { disabled } : {})}
				onValueChange={emitChange}
			>
				<SelectTrigger
					aria-label={accessibleLabel || undefined}
					className="h-8 w-auto gap-0.5 rounded-md border-0 bg-transparent px-1.5 py-0 text-sm font-medium shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>span]:flex-none [&>svg]:size-3.5 [&>svg]:text-muted-foreground"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent
					className={cn(
						'max-h-64 rounded-lg border-border/90 bg-popover/98 p-1 shadow-(--shadow-3) backdrop-blur-md',
						isYearDropdown ? 'min-w-24' : 'min-w-28'
					)}
				>
					{options?.map((option) => (
						<SelectItem
							key={option.value}
							value={String(option.value)}
							disabled={option.disabled}
							className="py-1.5 text-sm"
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</span>
	)
}

export function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	captionLayout = 'dropdown',
	navLayout = 'around',
	fixedWeeks = true,
	formatters,
	components,
	labels,
	...props
}: CalendarProps) {
	const defaultClassNames = getDefaultClassNames()

	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			captionLayout={captionLayout}
			navLayout={navLayout}
			fixedWeeks={fixedWeeks}
			className={cn('group/calendar w-fit rounded-lg bg-popover p-2.5 [--cell-size:2rem]', className)}
			formatters={{
				formatCaption: formatMonthYear,
				formatMonthDropdown: (date) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date),
				formatYearDropdown: (date) => new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(date),
				formatWeekdayName: (date) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(date),
				...formatters
			}}
			labels={{
				labelNav: () => t('common.date-picker.navigation'),
				labelNext: () => t('common.date-picker.next-month'),
				labelPrevious: () => t('common.date-picker.previous-month'),
				labelMonthDropdown: () => t('common.date-picker.choose-month'),
				labelYearDropdown: () => t('common.date-picker.choose-year'),
				...labels
			}}
			classNames={{
				root: cn('w-fit', defaultClassNames.root),
				months: cn('relative flex flex-col gap-4 md:flex-row', defaultClassNames.months),
				month: cn('flex w-full flex-col gap-3', defaultClassNames.month),
				nav: cn(
					'absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
					defaultClassNames.nav
				),
				button_previous: cn(
					'inline-flex size-(--cell-size) items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--motion-duration-fast) hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-40',
					defaultClassNames.button_previous
				),
				button_next: cn(
					'inline-flex size-(--cell-size) items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--motion-duration-fast) hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-40',
					defaultClassNames.button_next
				),
				month_caption: cn(
					'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
					defaultClassNames.month_caption
				),
				dropdowns: cn(
					'flex h-(--cell-size) w-full items-center justify-center gap-1 text-sm font-medium',
					defaultClassNames.dropdowns
				),
				dropdown_root: cn(
					'relative inline-flex rounded-md transition-colors duration-(--motion-duration-fast) hover:bg-accent data-disabled:pointer-events-none data-disabled:opacity-50',
					defaultClassNames.dropdown_root
				),
				dropdown: cn(
					'absolute inset-0 w-full cursor-pointer appearance-none bg-transparent opacity-0',
					defaultClassNames.dropdown
				),
				caption_label: cn(
					'select-none font-medium',
					captionLayout === 'label'
						? 'text-sm'
						: 'flex h-8 items-center gap-0.5 rounded-md px-1.5 text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
					defaultClassNames.caption_label
				),
				month_grid: cn('w-full border-collapse', defaultClassNames.month_grid),
				weekdays: cn('flex', defaultClassNames.weekdays),
				weekday: cn(
					'flex-1 select-none pb-1 font-medium text-[0.72rem] text-muted-foreground',
					defaultClassNames.weekday
				),
				week: cn('mt-1 flex w-full', defaultClassNames.week),
				day: cn(
					'group/day relative aspect-square h-full w-full select-none p-0 text-center',
					defaultClassNames.day
				),
				day_button: cn(
					'inline-flex aspect-square size-auto w-full min-w-(--cell-size) items-center justify-center rounded-md text-sm leading-none transition-[background-color,color] duration-(--motion-duration-fast) hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:font-medium group-data-[selected=true]/day:text-primary-foreground group-data-[selected=true]/day:hover:bg-primary group-data-[disabled=true]/day:pointer-events-none group-data-[disabled=true]/day:opacity-40',
					defaultClassNames.day_button
				),
				today: cn('font-semibold text-primary', defaultClassNames.today),
				outside: cn('text-muted-foreground/70', defaultClassNames.outside),
				disabled: cn('text-muted-foreground opacity-40', defaultClassNames.disabled),
				hidden: cn('invisible', defaultClassNames.hidden),
				...classNames
			}}
			components={{
				Chevron: CalendarChevron,
				Dropdown: CalendarDropdown,
				...components
			}}
			{...props}
		/>
	)
}
