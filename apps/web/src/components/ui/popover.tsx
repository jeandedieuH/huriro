import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
	className,
	align = 'center',
	sideOffset = 4,
	...props
}: PopoverPrimitive.PopoverContentProps) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				align={align}
				sideOffset={sideOffset}
				className={cn(
					'z-(--z-popover) w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-(--shadow-2) outline-none',
					className
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	)
}
