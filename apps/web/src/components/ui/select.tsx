import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
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
				className
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDown className="size-4 text-muted-foreground" aria-hidden />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
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
				<SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
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
