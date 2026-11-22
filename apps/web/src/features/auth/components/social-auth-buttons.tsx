import { t } from '@huriro/i18n'
import { Info, Loader2 } from 'lucide-react'
import { type ComponentType, type SVGProps, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { SOCIAL_PROVIDER_IDS, type SocialProviderId, signInWithSocial } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { AppleIcon, GitHubIcon, GoogleIcon } from './provider-icons'

export interface SocialAuthButtonsProps {
	readonly enabledProviders: readonly SocialProviderId[]
	readonly callbackURL: string
	readonly errorCallbackURL: string
	readonly disabled?: boolean | undefined
}

interface ProviderMeta {
	readonly label: () => string
	readonly icon: ComponentType<SVGProps<SVGSVGElement>>
	readonly clientIdKey: string
	readonly secretKey: string
}

const PROVIDER_META: Record<SocialProviderId, ProviderMeta> = {
	google: {
		label: () => t('auth.social.google'),
		icon: GoogleIcon,
		clientIdKey: 'GOOGLE_CLIENT_ID',
		secretKey: 'GOOGLE_CLIENT_SECRET'
	},
	github: {
		label: () => t('auth.social.github'),
		icon: GitHubIcon,
		clientIdKey: 'GITHUB_CLIENT_ID',
		secretKey: 'GITHUB_CLIENT_SECRET'
	},
	apple: {
		label: () => t('auth.social.apple'),
		icon: AppleIcon,
		clientIdKey: 'APPLE_CLIENT_ID',
		secretKey: 'APPLE_CLIENT_SECRET'
	}
}

/**
 * Google, GitHub, and Apple OAuth triggers with Better Auth social sign-in.
 * Providers not yet configured on the server stay discoverable and explain
 * exactly which server variables enable them (§17.15: never silent disabled UI).
 */
export function SocialAuthButtons({
	enabledProviders,
	callbackURL,
	errorCallbackURL,
	disabled = false
}: SocialAuthButtonsProps) {
	const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null)
	const [notice, setNotice] = useState<{ readonly tone: 'info' | 'error'; readonly message: string } | null>(
		null
	)

	async function handleProviderClick(provider: SocialProviderId) {
		if (disabled || pendingProvider !== null) return
		const meta = PROVIDER_META[provider]
		const providerName = meta.label()

		if (!enabledProviders.includes(provider)) {
			setNotice({
				tone: 'info',
				message: t('auth.social.not-configured', {
					provider: providerName,
					clientIdKey: meta.clientIdKey,
					secretKey: meta.secretKey
				})
			})
			return
		}

		setNotice(null)
		setPendingProvider(provider)
		try {
			const res = await signInWithSocial(provider, {
				callbackURL,
				newUserCallbackURL: '/onboarding',
				errorCallbackURL
			})
			if (res.url) {
				window.location.assign(res.url)
				return
			}
			setPendingProvider(null)
		} catch (err) {
			setNotice({
				tone: 'error',
				message: err instanceof Error ? err.message : t('auth.social.error.default')
			})
			setPendingProvider(null)
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
				{SOCIAL_PROVIDER_IDS.map((provider) => {
					const meta = PROVIDER_META[provider]
					const Icon = meta.icon
					const label = meta.label()
					const isEnabled = enabledProviders.includes(provider)
					const isPending = pendingProvider === provider

					return (
						<button
							key={provider}
							type="button"
							disabled={disabled || pendingProvider !== null}
							aria-label={t('auth.social.continue-with', { provider: label })}
							aria-busy={isPending || undefined}
							onClick={() => void handleProviderClick(provider)}
							className={cn(
								'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground shadow-(--shadow-1) transition-[background-color,border-color,opacity,transform] duration-(--motion-duration-fast)',
								'hover:border-ring/60 hover:bg-accent/70 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50',
								!isEnabled && 'opacity-75'
							)}
						>
							{isPending ? (
								<Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
							) : (
								<Icon className="size-4 shrink-0" />
							)}
							<span>{label}</span>
						</button>
					)
				})}
			</div>

			{notice ? (
				<div
					role={notice.tone === 'error' ? 'alert' : 'status'}
					className={cn(
						'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed',
						notice.tone === 'error'
							? 'border-destructive/30 bg-destructive/10 text-destructive'
							: 'border-border bg-surface-2 text-muted-foreground'
					)}
				>
					<Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
					<span>{notice.message}</span>
				</div>
			) : null}

			<div className="relative flex items-center gap-3 py-1">
				<Separator className="flex-1" />
				<span className="text-xs font-medium text-muted-foreground">{t('auth.social.divider')}</span>
				<Separator className="flex-1" />
			</div>
		</div>
	)
}
