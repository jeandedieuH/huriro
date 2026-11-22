import { t } from '@huriro/i18n'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogPortal = DialogPrimitive.Portal
export const DialogClose = DialogPrimitive.Close

export function DialogOverlay({ className, ...props }: DialogPrimitive.DialogOverlayProps) {
	return (
		<DialogPrimitive.Overlay
			className={cn('fixed inset-0 z-(--z-modal) bg-background/80 backdrop-blur-xs', className)}
			{...props}
		/>
	)
}

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				className={cn(
					'fixed top-1/2 left-1/2 z-(--z-modal) grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-(--shadow-3)',
					className
				)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close
					aria-label={t('common.close')}
					className="absolute top-4 right-4 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<X className="size-4" aria-hidden />
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPortal>
	)
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
	)
}

export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
	return (
		<DialogPrimitive.Title
			className={cn('text-lg font-semibold leading-ui tracking-tight', className)}
			{...props}
		/>
	)
}

export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
	return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}
