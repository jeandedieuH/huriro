import type { PublicDocResponse } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function resolveApiOrigin(): string {
	if (typeof window !== 'undefined') return ''
	return process.env['HURIRO_API_INTERNAL_URL'] ?? 'http://127.0.0.1:3001'
}

const COVER_BACKGROUNDS: Record<string, string> = {
	sunrise:
		'linear-gradient(135deg, color-mix(in oklch, var(--warning) 35%, var(--card)), color-mix(in oklch, var(--destructive) 25%, var(--card)))',
	ocean:
		'linear-gradient(135deg, color-mix(in oklch, var(--info) 35%, var(--card)), color-mix(in oklch, var(--primary) 28%, var(--card)))',
	forest:
		'linear-gradient(135deg, color-mix(in oklch, var(--success) 32%, var(--card)), color-mix(in oklch, var(--info) 22%, var(--card)))',
	slate: 'linear-gradient(135deg, var(--muted), var(--secondary))',
	plum: 'linear-gradient(135deg, color-mix(in oklch, var(--primary) 32%, var(--card)), color-mix(in oklch, var(--muted) 60%, var(--card)))'
}

export const Route = createFileRoute('/p/$workspaceSlug/$publicSlug')({
	ssr: true,
	loader: async ({ params }): Promise<PublicDocResponse | null> => {
		const url = `${resolveApiOrigin()}/api/v1/public/docs/${encodeURIComponent(params.workspaceSlug)}/${encodeURIComponent(params.publicSlug)}`
		try {
			const res = await fetch(url)
			if (!res.ok) return null
			return (await res.json()) as PublicDocResponse
		} catch {
			return null
		}
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: loaderData ? `${loaderData.title} — ${loaderData.workspaceName}` : 'Huriro' },
			{
				name: 'robots',
				content: loaderData?.allowSearchIndexing ? 'index, follow' : 'noindex, nofollow'
			}
		]
	}),
	component: PublicDocPageRoute
})

function PublicDocPageRoute() {
	const { workspaceSlug, publicSlug } = Route.useParams()
	const initialData = Route.useLoaderData()
	const [docData, setDocData] = useState<PublicDocResponse | null>(initialData)
	const [password, setPassword] = useState('')
	const [unlockError, setUnlockError] = useState(false)
	const [busy, setBusy] = useState(false)

	if (!docData) {
		return (
			<main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center p-8 text-center">
				<h1 className="text-xl font-semibold text-foreground">{t('docs.public.not-found')}</h1>
			</main>
		)
	}

	async function handleUnlock(ev: FormEvent) {
		ev.preventDefault()
		if (!password.trim() || busy) return
		setBusy(true)
		setUnlockError(false)
		try {
			const res = await fetch(
				`/api/v1/public/docs/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(publicSlug)}/unlock`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ password })
				}
			)
			if (!res.ok) {
				setUnlockError(true)
				return
			}
			setDocData((await res.json()) as PublicDocResponse)
			setPassword('')
		} finally {
			setBusy(false)
		}
	}

	if (docData.passwordRequired) {
		return (
			<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
				<form
					onSubmit={(ev) => void handleUnlock(ev)}
					className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-(--shadow-1)"
				>
					<div className="space-y-1">
						<Badge tone="outline">{docData.workspaceName}</Badge>
						<h1 className="text-lg font-semibold text-foreground">{t('docs.public.protected-title')}</h1>
						<p className="text-xs text-muted-foreground">{t('docs.public.password-prompt')}</p>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="public-doc-password" className="text-xs font-medium">
							{t('docs.public.password-label')}
						</label>
						<Input
							id="public-doc-password"
							type="password"
							value={password}
							onChange={(ev) => {
								setPassword(ev.target.value)
								setUnlockError(false)
							}}
							required
						/>
					</div>
					{unlockError ? (
						<p role="alert" className="text-xs text-destructive">
							{t('docs.public.invalid-password')}
						</p>
					) : null}
					<Button type="submit" disabled={busy} className="w-full">
						{t('docs.public.unlock')}
					</Button>
				</form>
			</main>
		)
	}

	const coverBg = docData.coverGradient ? COVER_BACKGROUNDS[docData.coverGradient] : undefined
	const containerWidth = docData.fullWidth ? 'max-w-6xl' : 'max-w-3xl'
	const mdHref = `/api/v1/public/docs/${encodeURIComponent(docData.workspaceSlug)}/${encodeURIComponent(docData.publicSlug)}.md`
	const llmsHref = `/api/v1/public/docs/${encodeURIComponent(docData.workspaceSlug)}/llms.txt`

	return (
		<div className="min-h-dvh bg-background text-foreground">
			{coverBg ? (
				<div className="h-36 w-full border-b border-border" style={{ backgroundImage: coverBg }} />
			) : null}

			<div className={`mx-auto ${containerWidth} px-6 py-10`}>
				<header className="mb-8 space-y-2 border-b border-border pb-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Badge tone="outline">{docData.workspaceName}</Badge>
						<div className="flex items-center gap-3 text-xs text-muted-foreground">
							<a href={mdHref} className="hover:text-foreground hover:underline">
								{t('docs.export.markdown')}
							</a>
							<a href={llmsHref} className="hover:text-foreground hover:underline">
								{t('docs.publish.llms-txt')}
							</a>
						</div>
					</div>
					<h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
						{docData.icon ? <span aria-hidden>{docData.icon}</span> : null}
						<span>{docData.title}</span>
					</h1>
				</header>

				<div className="grid gap-8 lg:grid-cols-4">
					<article
						data-font-style={docData.fontStyle}
						data-small-text={docData.smallText ? 'true' : undefined}
						className="huriro-editor lg:col-span-3 space-y-4 text-sm leading-relaxed"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized by @huriro/editor sanitizeHtml()
						dangerouslySetInnerHTML={{ __html: docData.html }}
					/>

					{docData.headings.length > 0 || docData.children.length > 0 ? (
						<aside className="space-y-6 text-xs">
							{docData.headings.length > 0 ? (
								<nav aria-label={t('docs.panel.toc')} className="space-y-1.5">
									<p className="font-semibold uppercase tracking-wide text-muted-foreground">
										{t('docs.panel.toc')}
									</p>
									<ul className="space-y-1">
										{docData.headings.map((h) => (
											<li
												key={`${h.blockId}-${h.offset}`}
												style={{ paddingLeft: `${Math.max(0, h.level - 1) * 10}px` }}
											>
												<span className="text-muted-foreground">{h.text}</span>
											</li>
										))}
									</ul>
								</nav>
							) : null}

							{docData.children.length > 0 ? (
								<nav aria-label={t('docs.public.subpages')} className="space-y-1.5">
									<p className="font-semibold uppercase tracking-wide text-muted-foreground">
										{t('docs.public.subpages')}
									</p>
									<ul className="space-y-1">
										{docData.children.map((child) => (
											<li key={child.id}>
												<a href={`#child-${child.slug}`} className="text-primary hover:underline">
													{child.icon ? `${child.icon} ` : ''}
													{child.title}
												</a>
											</li>
										))}
									</ul>
								</nav>
							) : null}
						</aside>
					) : null}
				</div>

				{docData.children.length > 0 ? (
					<div className="mt-12 space-y-10 border-t border-border pt-8">
						{docData.children.map((child) => (
							<section key={child.id} id={`child-${child.slug}`} className="space-y-3">
								<h2 className="text-xl font-semibold">
									{child.icon ? `${child.icon} ` : ''}
									{child.title}
								</h2>
								<div
									data-font-style={docData.fontStyle}
									data-small-text={docData.smallText ? 'true' : undefined}
									className="huriro-editor text-sm leading-relaxed"
									// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized by @huriro/editor sanitizeHtml()
									dangerouslySetInnerHTML={{ __html: child.html }}
								/>
							</section>
						))}
					</div>
				) : null}
			</div>
		</div>
	)
}
