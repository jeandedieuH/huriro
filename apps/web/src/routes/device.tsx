import { type MessageId, t } from '@huriro/i18n'
import { en } from '@huriro/i18n/locales/en'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { KeyRound, MonitorSmartphone, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthLayout } from '@/features/auth/components/auth-layout'
import {
	type DeviceVerification,
	deviceApprove,
	deviceDeny,
	deviceVerify,
	OAuthRequestError
} from '@/lib/oauth'

interface DeviceSearch {
	readonly user_code?: string | undefined
}

export const Route = createFileRoute('/device')({
	validateSearch: (search: Record<string, unknown>): DeviceSearch => ({
		...(typeof search['user_code'] === 'string' ? { user_code: search['user_code'] } : {})
	}),
	component: DeviceRoute
})

function scopeMessageId(scope: string): MessageId | null {
	const id = `oauth.consent.scope-desc.${scope}`
	return id in en ? (id as MessageId) : null
}

type Step =
	| { readonly kind: 'entry' }
	| { readonly kind: 'confirm'; readonly info: DeviceVerification }
	| { readonly kind: 'done'; readonly approved: boolean }

/** RFC 8628 device-code confirmation (§13.1a): verify → review scopes → approve/deny. */
function DeviceRoute() {
	const navigate = useNavigate()
	const { user_code } = Route.useSearch()

	const [code, setCode] = useState(user_code ?? '')
	const [step, setStep] = useState<Step>({ kind: 'entry' })
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	function handleAuthLoss() {
		const target = `/device${window.location.search}`
		void navigate({ to: '/sign-in', search: { redirect: target } })
	}

	async function verify(ev?: React.FormEvent) {
		ev?.preventDefault()
		const trimmed = code.trim()
		if (!trimmed || busy) return
		setBusy(true)
		setError(null)
		try {
			const info = await deviceVerify(trimmed)
			setStep({ kind: 'confirm', info })
		} catch (err) {
			if (err instanceof OAuthRequestError && err.status === 401) {
				handleAuthLoss()
				return
			}
			setError(err instanceof Error ? err.message : t('device.error-invalid'))
		} finally {
			setBusy(false)
		}
	}

	async function decide(approve: boolean, userCode: string) {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			if (approve) await deviceApprove(userCode)
			else await deviceDeny(userCode)
			setStep({ kind: 'done', approved: approve })
		} catch (err) {
			if (err instanceof OAuthRequestError && err.status === 401) {
				handleAuthLoss()
				return
			}
			const message =
				err instanceof OAuthRequestError && err.message.includes('already')
					? t('device.error-processed')
					: err instanceof Error
						? err.message
						: t('device.error-invalid')
			setError(message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<AuthLayout title={t('device.title')} subtitle={t('device.subtitle')}>
			{step.kind === 'entry' ? (
				<form onSubmit={(ev) => void verify(ev)} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="device-code" className="text-sm font-medium">
							{t('device.code-label')}
						</label>
						<Input
							id="device-code"
							value={code}
							onChange={(ev) => setCode(ev.target.value.toUpperCase())}
							placeholder="ABCD-1234"
							autoComplete="off"
							autoFocus
							className="font-mono tracking-widest"
							required
						/>
					</div>
					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}
					<Button type="submit" className="w-full" loading={busy}>
						{t('device.verify')}
					</Button>
				</form>
			) : null}

			{step.kind === 'confirm' ? (
				<div className="space-y-5">
					<div className="rounded-lg border border-border bg-card p-4">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<MonitorSmartphone className="size-4 text-muted-foreground" aria-hidden />
							{t('device.client')}
						</h2>
						<p className="mt-1 font-mono text-sm">{step.info.client_id ?? '—'}</p>

						{step.info.scope ? (
							<>
								<h3 className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm font-semibold">
									<KeyRound className="size-4 text-muted-foreground" aria-hidden />
									{t('device.requested-scopes')}
								</h3>
								<ul className="mt-2 space-y-1.5">
									{step.info.scope
										.split(' ')
										.filter(Boolean)
										.map((scope) => {
											const msgId = scopeMessageId(scope)
											return (
												<li key={scope} className="flex items-start gap-2 text-sm">
													<ShieldCheck
														className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
														aria-hidden
													/>
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
							</>
						) : null}
					</div>

					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}

					<div className="flex gap-3">
						<Button className="flex-1" onClick={() => void decide(true, step.info.user_code)} loading={busy}>
							{t('device.approve')}
						</Button>
						<Button
							className="flex-1"
							tone="outline"
							onClick={() => void decide(false, step.info.user_code)}
							disabled={busy}
						>
							{t('device.deny')}
						</Button>
					</div>
				</div>
			) : null}

			{step.kind === 'done' ? (
				<div role="status" className="rounded-lg border border-border bg-card p-5 text-sm">
					<p className="font-medium">{step.approved ? t('device.approved') : t('device.denied')}</p>
				</div>
			) : null}
		</AuthLayout>
	)
}
