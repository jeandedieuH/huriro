import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
	className,
	sideOffset = 4,
	...props
}: TooltipPrimitive.TooltipContentProps) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					'z-(--z-toast) overflow-hidden rounded-md bg-foreground px-2 py-1 text-xs text-background',
					'animate-in fade-in-0 zoom-in-95 duration-(--motion-duration-fast)',
					className
				)}
				{...props}
			/>
		</TooltipPrimitive.Portal>
	)
}
