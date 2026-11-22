import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal
export const DropdownMenuSub = DropdownMenuPrimitive.Sub

export function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: DropdownMenuPrimitive.DropdownMenuContentProps) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					'z-(--z-popover) min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-(--shadow-2)',
					className
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	)
}

export function DropdownMenuItem({ className, ...props }: DropdownMenuPrimitive.DropdownMenuItemProps) {
	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
				'focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
				className
			)}
			{...props}
		/>
	)
}

export function DropdownMenuLabel({ className, ...props }: DropdownMenuPrimitive.DropdownMenuLabelProps) {
	return (
		<DropdownMenuPrimitive.Label
			className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)}
			{...props}
		/>
	)
}

export function DropdownMenuSeparator({
	className,
	...props
}: DropdownMenuPrimitive.DropdownMenuSeparatorProps) {
	return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}
