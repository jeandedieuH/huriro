import { type MessageId, t } from '@huriro/i18n'
import { en } from '@huriro/i18n/locales/en'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import { buildSignedOAuthQuery, decideConsent, OAuthRequestError } from '@/lib/oauth'

export const Route = createFileRoute('/oauth/consent')({
	// The signed OAuth query is opaque to the router — read it raw from the URL.
	validateSearch: (search) => search,
	component: ConsentRoute
})

/** Map a scope string to its description message id, when one exists. */
function scopeMessageId(scope: string): MessageId | null {
	const id = `oauth.consent.scope-desc.${scope}`
	return id in en ? (id as MessageId) : null
}

/**
 * OAuth consent screen (§13.1b): the authorize endpoint redirects here with a
 * server-signed query; the user sees the client + requested scopes and posts
 * their decision back inside `oauth_query`.
 */
function ConsentRoute() {
	const navigate = useNavigate()
	const searchStr = useRouterState({ select: (s) => s.location.searchStr })

	const signedQuery = useMemo(() => buildSignedOAuthQuery(searchStr), [searchStr])
	const params = useMemo(() => new URLSearchParams(searchStr), [searchStr])
	const clientName = params.get('client_name') ?? params.get('client_id')
	const scopes = useMemo(() => (params.get('scope') ?? '').split(' ').filter(Boolean), [params])
	const resource = params.get('resource')

	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function decide(accept: boolean) {
		if (!signedQuery || busy) return
		setBusy(true)
		setError(null)
		try {
			const result = await decideConsent(signedQuery, accept)
			if (result.url) {
				window.location.assign(result.url)
				return
			}
		} catch (err) {
			// Session gone mid-flow → bounce back through sign-in preserving the
			// signed query so the user lands right back here.
			if (err instanceof OAuthRequestError && err.status === 401) {
				void navigate({
					to: '/sign-in',
					search: { redirect: `/oauth/consent${window.location.search}` }
				})
				return
			}
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	if (!signedQuery) {
		return (
			<AuthLayout title={t('oauth.consent.title', { client: t('oauth.consent.client-unknown') })} subtitle="">
				<p role="alert" className="text-sm text-destructive">
					{t('oauth.consent.error-invalid')}
				</p>
			</AuthLayout>
		)
	}

	return (
		<AuthLayout
			title={t('oauth.consent.title', { client: clientName ?? t('oauth.consent.client-unknown') })}
			subtitle={t('oauth.consent.subtitle')}
		>
			<div className="space-y-5">
				<div className="rounded-lg border border-border bg-card p-4">
					<h2 className="flex items-center gap-2 text-sm font-semibold">
						<KeyRound className="size-4 text-muted-foreground" aria-hidden />
						{t('oauth.consent.requested-scopes')}
					</h2>
					<ul className="mt-3 space-y-1.5">
						{scopes.map((scope) => {
							const msgId = scopeMessageId(scope)
							return (
								<li key={scope} className="flex items-start gap-2 text-sm">
									<ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
									<span>
										<span className="font-medium">{msgId ? t(msgId) : scope}</span>
										{msgId ? (
											<span className="ml-1.5 font-mono text-xs text-muted-foreground">{scope}</span>
										) : null}
									</span>
								</li>
							)
						})}
					</ul>
					{resource ? (
						<p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
							<span className="font-medium text-foreground">{t('oauth.consent.resource')}:</span>{' '}
							<span className="break-all font-mono">{resource}</span>
						</p>
					) : null}
				</div>

				{error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : null}

				<div className="flex gap-3">
					<Button className="flex-1" onClick={() => void decide(true)} loading={busy}>
						{t('oauth.consent.allow')}
					</Button>
					<Button className="flex-1" tone="outline" onClick={() => void decide(false)} disabled={busy}>
						{t('oauth.consent.deny')}
					</Button>
				</div>
			</div>
		</AuthLayout>
	)
}
