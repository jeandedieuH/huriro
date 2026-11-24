import type { BillingPaymentMethod, BillingSummaryResponse, CheckoutSessionDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { CreditCard, ExternalLink, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWorkspace } from '@/lib/workspace'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardHeader,
	SettingsNotice,
	SettingsSkeleton
} from './settings-primitives'

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
		return <SettingsSkeleton rows={3} />
	}

	const sub = summary?.subscription
	const usage = summary?.usage
	const quote = summary?.quote
	const seatLimit = sub?.seatLimit ?? 5
	const activeSeats = usage?.activeSeats ?? 0
	const seatRatio = seatLimit > 0 ? Math.min(100, Math.round((activeSeats / seatLimit) * 100)) : 0

	return (
		<div className="space-y-5">
			<SettingsCard labelledBy="settings-billing-heading">
				<SettingsCardHeader
					headingId="settings-billing-heading"
					icon={<CreditCard className="size-4" />}
					title={t('settings.billing.title')}
					description={t('settings.billing.desc')}
					action={
						sub ? (
							<div className="flex items-center gap-1.5">
								<Badge tone="default">{sub.plan.toUpperCase()}</Badge>
								<Badge tone={sub.status === 'active' ? 'success' : 'danger'}>{sub.status}</Badge>
							</div>
						) : null
					}
				/>
				<SettingsCardBody>
					{usage && quote ? (
						<div className="grid gap-3 sm:grid-cols-3">
							<div className="rounded-lg border border-border bg-surface-2/40 p-3.5">
								<p className="text-[11px] font-medium text-muted-foreground">
									{t('settings.billing.price-usd')}
								</p>
								<p className="mt-1 text-base font-semibold text-foreground tnum">
									${quote.usdAmount.toFixed(2)} USD / mo
								</p>
							</div>
							<div className="rounded-lg border border-border bg-surface-2/40 p-3.5">
								<p className="text-[11px] font-medium text-muted-foreground">
									{t('settings.billing.price-rwf')}
								</p>
								<p className="mt-1 text-base font-semibold text-foreground tnum">
									{quote.rwfAmount.toLocaleString('en-US')} RWF
								</p>
								<p className="mt-0.5 text-[11px] text-muted-foreground tnum">
									{t('settings.billing.fx-rate', {
										rate: quote.exchangeRateUsdToRwf,
										source: quote.exchangeRateSource
									})}
								</p>
							</div>
							<div className="rounded-lg border border-border bg-surface-2/40 p-3.5">
								<p className="text-[11px] font-medium text-muted-foreground">{t('settings.billing.seats')}</p>
								<p className="mt-1 text-base font-semibold text-foreground tnum">
									{activeSeats} / {seatLimit}
								</p>
								<div
									role="progressbar"
									aria-label={t('settings.billing.seats')}
									aria-valuenow={activeSeats}
									aria-valuemin={0}
									aria-valuemax={seatLimit}
									className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
								>
									<div className="h-full rounded-full bg-primary" style={{ width: `${seatRatio}%` }} />
								</div>
							</div>
						</div>
					) : null}
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard labelledBy="settings-billing-payment-heading">
				<SettingsCardHeader
					headingId="settings-billing-payment-heading"
					icon={<Smartphone className="size-4" />}
					title={t('settings.billing.payment-title')}
				/>
				<SettingsCardBody>
					<div className="space-y-1.5">
						<label htmlFor="billing-receipt-email" className="text-xs font-medium text-foreground">
							{t('settings.billing.receipt-email')}
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
								<fieldset className="m-0 border-0 p-0">
									<legend className="mb-1.5 text-xs font-medium text-foreground">
										{t('settings.billing.momo-method')}
									</legend>
									<div className="flex flex-wrap gap-2">
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
								</fieldset>

								{momoChannel !== 'irembopay_hosted' ? (
									<div className="space-y-1.5">
										<label htmlFor="billing-momo-phone" className="text-xs font-medium text-foreground">
											{t('settings.billing.momo-phone')}
										</label>
										<Input
											id="billing-momo-phone"
											type="tel"
											className="font-mono tnum"
											value={phoneNumber}
											onChange={(e) => setPhoneNumber(e.target.value)}
											placeholder="0788123456"
										/>
									</div>
								) : null}

								<Button type="submit" size="sm" disabled={busy} loading={busy}>
									{t('settings.billing.pay-momo', {
										amount: (quote?.rwfAmount ?? 14000).toLocaleString('en-US')
									})}
								</Button>
							</form>
						</TabsContent>

						<TabsContent value="polar" className="mt-3 space-y-3">
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t('settings.billing.polar-desc', {
									amount: `$${quote?.usdAmount.toFixed(2) ?? '10.00'} USD`
								})}
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									size="sm"
									disabled={busy}
									loading={busy}
									onClick={() => void handlePolarCheckout()}
								>
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
						<SettingsNotice
							tone="success"
							title={`${t('settings.billing.checkout-ready')} — ${checkout.amount.toLocaleString('en-US')} ${checkout.currency}`}
						>
							{checkout.instructions ? <p>{checkout.instructions}</p> : null}
							{checkout.url ? (
								<a
									href={checkout.url}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
								>
									<span>{t('settings.billing.open-checkout')}</span>
									<ExternalLink className="size-3" aria-hidden />
								</a>
							) : null}
						</SettingsNotice>
					) : null}

					{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
