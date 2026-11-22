import { t } from '@huriro/i18n'
import { AppShell } from '@/components/app-shell/app-shell'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** M0 component showcase — the living check that tokens + components compose. */
export function App() {
	return (
		<AppShell activeNav="tasks">
			<div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
				<section className="flex flex-wrap items-center gap-2">
					<Button>Default</Button>
					<Button tone="secondary">Secondary</Button>
					<Button tone="outline">Outline</Button>
					<Button tone="ghost">Ghost</Button>
					<Button tone="destructive">Destructive</Button>
					<Button tone="link">Link</Button>
					<Button loading>Loading</Button>
					<Button disabled>Disabled</Button>
				</section>
				<Separator />
				<section className="grid gap-4 sm:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle>Card title</CardTitle>
							<CardDescription>Semantic tokens, elevation-1.</CardDescription>
						</CardHeader>
						<CardContent className="flex gap-2">
							<Badge>Default</Badge>
							<Badge tone="success">Success</Badge>
							<Badge tone="warning">Warning</Badge>
							<Badge tone="danger">Danger</Badge>
							<Badge tone="info">Info</Badge>
							<Badge tone="outline">Outline</Badge>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>Inputs</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-2">
							<Input placeholder="Normal" />
							<Input placeholder="Invalid" invalid defaultValue="bad@" />
							<Input placeholder="Disabled" disabled />
							<div className="flex items-center gap-2">
								<Avatar>
									<AvatarFallback>HG</AvatarFallback>
								</Avatar>
								<Kbd>Esc</Kbd>
								<Kbd>↵</Kbd>
							</div>
						</CardContent>
					</Card>
				</section>
				<Tabs defaultValue="empty">
					<TabsList>
						<TabsTrigger value="empty">Empty</TabsTrigger>
						<TabsTrigger value="error">Error</TabsTrigger>
						<TabsTrigger value="loading">Loading</TabsTrigger>
					</TabsList>
					<TabsContent value="empty">
						<EmptyState
							action={
								<Button tone="outline" size="sm">
									{t('shell.new')}
								</Button>
							}
						/>
					</TabsContent>
					<TabsContent value="error">
						<ErrorState
							message="The request failed."
							action={
								<Button tone="outline" size="sm">
									{t('error.retry')}
								</Button>
							}
						/>
					</TabsContent>
					<TabsContent value="loading">
						<div className="flex flex-col gap-2">
							<Skeleton className="h-4 w-2/3" />
							<Skeleton className="h-4 w-1/2" />
							<Skeleton className="h-20 w-full" />
						</div>
					</TabsContent>
				</Tabs>
			</div>
		</AppShell>
	)
}
