import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({ className, children, ...props }: SelectPrimitive.SelectTriggerProps) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-(--shadow-1)',
				'placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
				'[&>span]:min-w-0 [&>span]:truncate',
				className
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	)
}

export function SelectScrollUpButton({ className, ...props }: SelectPrimitive.SelectScrollUpButtonProps) {
	return (
		<SelectPrimitive.ScrollUpButton
			className={cn('flex cursor-default items-center justify-center py-1', className)}
			{...props}
		>
			<ChevronUp className="size-3.5 text-muted-foreground" aria-hidden />
		</SelectPrimitive.ScrollUpButton>
	)
}

export function SelectScrollDownButton({ className, ...props }: SelectPrimitive.SelectScrollDownButtonProps) {
	return (
		<SelectPrimitive.ScrollDownButton
			className={cn('flex cursor-default items-center justify-center py-1', className)}
			{...props}
		>
			<ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
		</SelectPrimitive.ScrollDownButton>
	)
}

export function SelectContent({
	className,
	children,
	position = 'popper',
	...props
}: SelectPrimitive.SelectContentProps) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				position={position}
				className={cn(
					'relative z-(--z-popover) max-h-80 min-w-32 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-(--shadow-2)',
					position === 'popper' && 'translate-y-1',
					className
				)}
				{...props}
			>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	)
}

export function SelectItem({ className, children, ...props }: SelectPrimitive.SelectItemProps) {
	return (
		<SelectPrimitive.Item
			className={cn(
				'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none',
				'focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
				className
			)}
			{...props}
		>
			<span className="absolute right-2 flex size-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<Check className="size-4" aria-hidden />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	)
}
