import type { BillingPaymentMethod, BillingSummaryResponse, CheckoutSessionDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { CreditCard, ExternalLink, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWorkspace } from '@/lib/workspace'

const RwandaPhoneSchema = z
	.string()
	.trim()
	.regex(/^(?:\+?250|0)?7[2389]\d{7}$/, 'Enter a valid Rwanda MTN (078/079) or Airtel (072/073) number')

export function BillingSettingsPanel() {
	const { api, mode } = useWorkspace()

	const [summary, setSummary] = useState<BillingSummaryResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [checkout, setCheckout] = useState<CheckoutSessionDto | null>(null)

	const [billingEmail, setBillingEmail] = useState('')
	const [momoChannel, setMomoChannel] = useState<Exclude<BillingPaymentMethod, 'card'>>('mtn_momo')
	const [phoneNumber, setPhoneNumber] = useState('')

	useEffect(() => {
		if (mode !== 'cloud') {
			setLoading(false)
			return
		}
		let cancelled = false
		void api
			.getBillingSubscription()
			.then((data) => {
				if (cancelled) return
				setSummary(data)
				setLoading(false)
			})
			.catch((err) => {
				if (cancelled) return
				setError(err instanceof Error ? err.message : t('settings.billing.error'))
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api, mode])

	if (mode !== 'cloud') return null

	async function handlePolarCheckout() {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			const res = await api.createBillingCheckout({
				plan: 'pro',
				provider: 'polar',
				paymentMethod: 'card',
				successUrl: `${window.location.origin}/settings?billing=success`,
				cancelUrl: `${window.location.origin}/settings?billing=cancel`,
				...(billingEmail.trim() ? { billingEmail: billingEmail.trim() } : {})
			})
			setCheckout(res)
		} catch (err) {
			setError(err instanceof Error ? err.message : t('settings.billing.error'))
		} finally {
			setBusy(false)
		}
	}

	async function handleIremboCheckout(ev: React.FormEvent) {
		ev.preventDefault()
		if (busy) return
		if (momoChannel === 'mtn_momo' || momoChannel === 'airtel_money') {
			const parsed = RwandaPhoneSchema.safeParse(phoneNumber)
			if (!parsed.success) {
				setError(parsed.error.issues[0]?.message ?? 'Invalid Rwandan Mobile Money phone number')
				return
			}
		}
		setBusy(true)
		setError(null)
		try {
			const res = await api.createBillingCheckout({
				plan: 'pro',
				provider: 'irembopay',
				paymentMethod: momoChannel,
				successUrl: `${window.location.origin}/settings?billing=success`,
				cancelUrl: `${window.location.origin}/settings?billing=cancel`,
				...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
				...(billingEmail.trim() ? { billingEmail: billingEmail.trim() } : {})
			})
			setCheckout(res)
		} catch (err) {
			setError(err instanceof Error ? err.message : t('settings.billing.error'))
		} finally {
			setBusy(false)
		}
	}

	async function handleOpenPortal() {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			const res = await api.createBillingPortal({ returnUrl: window.location.href })
			window.open(res.url, '_blank', 'noopener,noreferrer')
		} catch (err) {
			setError(err instanceof Error ? err.message : t('settings.billing.error'))
		} finally {
			setBusy(false)
		}
	}

	if (loading) {
		return (
			<div className="space-y-3 rounded-lg border border-border bg-card p-4">
				<Skeleton className="h-5 w-48" />
				<Skeleton className="h-24 w-full" />
			</div>
		)
	}

	const sub = summary?.subscription
	const usage = summary?.usage
	const quote = summary?.quote

	return (
		<section
			aria-labelledby="settings-billing-heading"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 id="settings-billing-heading" className="text-sm font-semibold">
						{t('settings.billing.title')}
					</h2>
					<p className="text-xs text-muted-foreground">{t('settings.billing.desc')}</p>
				</div>
				{sub ? (
					<div className="flex items-center gap-1.5">
						<Badge tone="default">{sub.plan.toUpperCase()}</Badge>
						<Badge tone={sub.status === 'active' ? 'secondary' : 'danger'}>{sub.status}</Badge>
					</div>
				) : null}
			</div>

			{usage && quote ? (
				<div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-3">
					<div>
						<div className="text-[11px] text-muted-foreground">{t('settings.billing.price-usd')}</div>
						<div className="text-sm font-semibold">${quote.usdAmount.toFixed(2)} USD / mo</div>
					</div>
					<div>
						<div className="text-[11px] text-muted-foreground">{t('settings.billing.price-rwf')}</div>
						<div className="text-sm font-semibold">{quote.rwfAmount.toLocaleString('en-US')} RWF</div>
						<div className="text-[10px] text-muted-foreground">
							{t('settings.billing.fx-rate', {
								rate: quote.exchangeRateUsdToRwf,
								source: quote.exchangeRateSource
							})}
						</div>
					</div>
					<div>
						<div className="text-[11px] text-muted-foreground">{t('settings.billing.seats')}</div>
						<div className="text-sm font-semibold">
							{usage.activeSeats} / {sub?.seatLimit ?? 5}
						</div>
					</div>
				</div>
			) : null}

			<div className="space-y-1.5">
				<label htmlFor="billing-receipt-email" className="text-xs font-medium">
					Receipt / billing email (optional)
				</label>
				<Input
					id="billing-receipt-email"
					type="email"
					value={billingEmail}
					onChange={(e) => setBillingEmail(e.target.value)}
					placeholder="billing@company.rw"
				/>
			</div>

			<Tabs defaultValue="irembopay">
				<TabsList>
					<TabsTrigger value="irembopay">
						<Smartphone className="mr-1.5 size-3.5" aria-hidden />
						{t('settings.billing.provider-irembopay')}
					</TabsTrigger>
					<TabsTrigger value="polar">
						<CreditCard className="mr-1.5 size-3.5" aria-hidden />
						{t('settings.billing.provider-polar')}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="irembopay" className="mt-3">
					<form onSubmit={(e) => void handleIremboCheckout(e)} className="space-y-3">
						<div
							className="flex flex-wrap gap-2"
							role="radiogroup"
							aria-label={t('settings.billing.momo-method')}
						>
							{(
								[
									{ id: 'mtn_momo', label: t('settings.billing.momo-mtn') },
									{ id: 'airtel_money', label: t('settings.billing.momo-airtel') },
									{ id: 'irembopay_hosted', label: t('settings.billing.irembopay-hosted') }
								] as const
							).map((opt) => (
								<Button
									key={opt.id}
									type="button"
									size="sm"
									tone={momoChannel === opt.id ? 'default' : 'outline'}
									aria-pressed={momoChannel === opt.id}
									onClick={() => setMomoChannel(opt.id)}
								>
									{opt.label}
								</Button>
							))}
						</div>

						{momoChannel !== 'irembopay_hosted' ? (
							<div className="space-y-1.5">
								<label htmlFor="billing-momo-phone" className="text-xs font-medium">
									{t('settings.billing.momo-phone')}
								</label>
								<Input
									id="billing-momo-phone"
									type="tel"
									value={phoneNumber}
									onChange={(e) => setPhoneNumber(e.target.value)}
									placeholder="0788123456"
								/>
							</div>
						) : null}

						<Button type="submit" size="sm" disabled={busy}>
							{t('settings.billing.pay-momo', {
								amount: (quote?.rwfAmount ?? 14000).toLocaleString('en-US')
							})}
						</Button>
					</form>
				</TabsContent>

				<TabsContent value="polar" className="mt-3 space-y-3">
					<p className="text-xs text-muted-foreground">
						International Visa/Mastercard/Apple Pay checkout processed securely by Polar ($
						{quote?.usdAmount.toFixed(2) ?? '10.00'} USD / workspace).
					</p>
					<div className="flex flex-wrap gap-2">
						<Button type="button" size="sm" disabled={busy} onClick={() => void handlePolarCheckout()}>
							{t('settings.billing.upgrade-polar')}
						</Button>
						{sub?.provider === 'polar' && sub.providerCustomerId ? (
							<Button
								type="button"
								size="sm"
								tone="outline"
								disabled={busy}
								onClick={() => void handleOpenPortal()}
							>
								{t('settings.billing.manage-portal')}
							</Button>
						) : null}
					</div>
				</TabsContent>
			</Tabs>

			{checkout ? (
				<div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1.5">
					<div className="font-medium">
						{t('settings.billing.checkout-ready')} — {checkout.amount.toLocaleString('en-US')}{' '}
						{checkout.currency}
					</div>
					{checkout.instructions ? <p className="text-muted-foreground">{checkout.instructions}</p> : null}
					{checkout.url ? (
						<a
							href={checkout.url}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 font-medium text-primary underline"
						>
							<span>Open payment checkout</span>
							<ExternalLink className="size-3" aria-hidden />
						</a>
					) : null}
				</div>
			) : null}

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</section>
	)
}
