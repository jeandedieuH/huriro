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
					'huriro-popover z-(--z-popover) w-72 rounded-xl border border-border/90 bg-popover/95 p-3 text-popover-foreground shadow-(--shadow-3) outline-none backdrop-blur-md',
					className
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	)
}
