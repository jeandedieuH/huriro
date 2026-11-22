import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
	return (
		<TabsPrimitive.List
			className={cn(
				'inline-flex h-9 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
				className
			)}
			{...props}
		/>
	)
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
	return (
		<TabsPrimitive.Trigger
			className={cn(
				'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-all duration-(--motion-duration-fast)',
				'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-(--shadow-1)',
				'disabled:pointer-events-none disabled:opacity-50',
				className
			)}
			{...props}
		/>
	)
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps) {
	return <TabsPrimitive.Content className={cn('mt-2', className)} {...props} />
}
