import { activateI18n, t } from '@huriro/i18n'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/http'
import { isAllowedOnboardingPath } from '@/lib/navigation'
import { expectNoViolations } from '@/lib/test-setup'
import { OnboardingForm } from './components/onboarding-form'
import { SetupForm } from './components/setup-form'
import { SignInForm } from './components/sign-in-form'
import { SignUpForm } from './components/sign-up-form'
import { AuthFlowProvider } from './context'

activateI18n('en')

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

const originalAdapter = api.defaults.adapter

/** Capture axios traffic through the shared api client (the fetch stub's axios-era equivalent). */
function stubApiAdapter(
	respond: (config: InternalAxiosRequestConfig) => { data: unknown; status?: number }
): { calls: { url: string; method: string; data: unknown }[] } {
	const calls: { url: string; method: string; data: unknown }[] = []
	api.defaults.adapter = async (config): Promise<AxiosResponse> => {
		calls.push({ url: config.url ?? '', method: config.method ?? 'get', data: config.data })
		const out = respond(config)
		return { data: out.data, status: out.status ?? 200, statusText: 'OK', headers: {}, config }
	}
	return { calls }
}

describe('auth forms', () => {
	beforeEach(() => {
		vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	})

	afterEach(() => {
		if (originalAdapter !== undefined) api.defaults.adapter = originalAdapter
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('SignInForm validates with Zod, toggles password, handles social auth, and passes axe', async () => {
		const assignMock = vi.fn()
		vi.stubGlobal('location', { ...window.location, assign: assignMock })

		const { calls } = stubApiAdapter((config) => {
			if ((config.url ?? '').endsWith('/api/auth/sign-in/social')) {
				return { data: { url: 'https://accounts.google.com/o/oauth2/v2/auth', redirect: true } }
			}
			return { data: { token: 'tok', user: { id: '1' } } }
		})

		const onComplete = vi.fn()
		const onNavigate = vi.fn()

		const { container } = render(
			<AuthFlowProvider
				value={{
					needsSetup: true,
					socialProviders: ['google'],
					onboardingUser: null,
					onAuthenticated: onComplete,
					onUsePreview: vi.fn(),
					onSignOut: async () => {},
					onNavigate
				}}
			>
				<SignInForm socialProviders={['google']} needsSetup redirectTo="/docs/rfc" onComplete={onComplete} />
			</AuthFlowProvider>
		)

		// Navigation links to /sign-up and /setup are present with redirect preserved
		const createLink = screen.getByRole('link', { name: t('auth.sign-in.create-link') })
		expect(createLink).toHaveAttribute('href', '/sign-up?redirect=%2Fdocs%2Frfc')
		fireEvent.click(createLink)
		expect(onNavigate).toHaveBeenCalledWith('/sign-up', { redirect: '/docs/rfc' })

		expect(screen.getByRole('link', { name: t('auth.sign-in.setup-link') })).toHaveAttribute(
			'href',
			'/setup?redirect=%2Fdocs%2Frfc'
		)

		// Unconfigured provider shows helpful config notice instead of silently failing
		fireEvent.click(screen.getByRole('button', { name: /github/i }))
		expect(await screen.findByRole('status')).toHaveTextContent('GITHUB_CLIENT_ID')

		// Configured provider calls better-auth social endpoint and redirects
		fireEvent.click(screen.getByRole('button', { name: /google/i }))
		await waitFor(() =>
			expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth')
		)

		// Empty submit triggers Zod errors
		fireEvent.click(screen.getByRole('button', { name: t('auth.sign-in.submit') }))
		expect(await screen.findByText(t('auth.validation.email-required'))).toBeInTheDocument()
		expect(screen.getByLabelText(t('auth.email'))).toHaveAttribute('aria-invalid', 'true')

		// Invalid email fails Zod validation
		fireEvent.input(screen.getByLabelText(t('auth.email')), { target: { value: 'not-an-email' } })
		fireEvent.input(screen.getByLabelText(t('auth.password')), { target: { value: 'secret1234' } })
		fireEvent.click(screen.getByRole('button', { name: t('auth.sign-in.submit') }))
		expect(await screen.findByText(t('auth.validation.email-invalid'))).toBeInTheDocument()

		// Password visibility toggle works
		const passwordInput = screen.getByLabelText(t('auth.password')) as HTMLInputElement
		expect(passwordInput.type).toBe('password')
		fireEvent.click(screen.getByRole('button', { name: t('auth.password.show') }))
		expect(passwordInput.type).toBe('text')

		// Valid credentials submit cleanly
		fireEvent.input(screen.getByLabelText(t('auth.email')), { target: { value: '  ada@huriro.dev  ' } })
		fireEvent.click(screen.getByRole('button', { name: t('auth.sign-in.submit') }))

		await waitFor(() => expect(onComplete).toHaveBeenCalledWith('/docs/rfc'))
		const signInCall = calls.find((c) => c.url === '/api/auth/sign-in/email')
		expect(signInCall?.method).toBe('post')
		expect(JSON.parse(String(signInCall?.data))).toEqual({
			email: 'ada@huriro.dev',
			password: 'secret1234',
			rememberMe: true
		})

		await expectNoViolations(container)
	})

	it('SignUpForm checks password strength + confirmation mismatch, submits, links to /sign-in, and passes axe', async () => {
		const { calls } = stubApiAdapter(() => ({ data: { token: 'tok', user: { id: '1' } } }))

		const onComplete = vi.fn()
		const onNavigate = vi.fn()

		const { container } = render(
			<AuthFlowProvider
				value={{
					needsSetup: false,
					socialProviders: ['google', 'github', 'apple'],
					onboardingUser: null,
					onAuthenticated: onComplete,
					onUsePreview: vi.fn(),
					onSignOut: async () => {},
					onNavigate
				}}
			>
				<SignUpForm
					socialProviders={['google', 'github', 'apple']}
					redirectTo="/inbox"
					onComplete={onComplete}
				/>
			</AuthFlowProvider>
		)

		const signInLink = screen.getByRole('link', { name: t('auth.sign-up.sign-in-link') })
		expect(signInLink).toHaveAttribute('href', '/sign-in?redirect=%2Finbox')

		fireEvent.input(screen.getByLabelText(t('auth.display-name')), { target: { value: 'Ada Lovelace' } })
		fireEvent.input(screen.getByLabelText(t('auth.email')), { target: { value: 'ada@huriro.dev' } })
		fireEvent.input(screen.getByLabelText(t('auth.password')), { target: { value: 'CorrectHorse99!' } })
		expect(screen.getByText(t('auth.password.strength.strong'))).toBeInTheDocument()

		fireEvent.input(screen.getByLabelText(t('auth.confirm-password')), { target: { value: 'Mismatch99!' } })
		fireEvent.click(screen.getByRole('button', { name: t('auth.sign-up.submit') }))
		expect(await screen.findByText(t('auth.validation.passwords-mismatch'))).toBeInTheDocument()

		fireEvent.input(screen.getByLabelText(t('auth.confirm-password')), {
			target: { value: 'CorrectHorse99!' }
		})
		fireEvent.click(screen.getByRole('button', { name: t('auth.sign-up.submit') }))

		await waitFor(() => expect(onComplete).toHaveBeenCalledWith('/inbox'))
		const signUpCall = calls.find((c) => c.url === '/api/auth/sign-up/email')
		expect(signUpCall?.method).toBe('post')
		expect(JSON.parse(String(signUpCall?.data))).toEqual({
			name: 'Ada Lovelace',
			email: 'ada@huriro.dev',
			password: 'CorrectHorse99!'
		})

		await expectNoViolations(container)
	})

	it('SetupForm auto-derives slug, respects manual edits, handles already-configured view, and passes axe', async () => {
		const { container, rerender } = render(<SetupForm needsSetup onComplete={vi.fn()} />)

		expect(screen.getByRole('link', { name: t('auth.setup.sign-in-link') })).toHaveAttribute(
			'href',
			'/sign-in'
		)

		const nameInput = screen.getByLabelText(t('auth.workspace-name')) as HTMLInputElement
		const slugInput = screen.getByLabelText(t('auth.workspace-slug')) as HTMLInputElement

		fireEvent.input(nameInput, { target: { value: 'Acme Engineering!' } })
		expect(slugInput.value).toBe('acme-engineering')

		// Once manually edited, workspace name changes no longer overwrite slug
		fireEvent.input(slugInput, { target: { value: 'custom-slug' } })
		fireEvent.input(nameInput, { target: { value: 'New Name' } })
		expect(slugInput.value).toBe('custom-slug')

		fireEvent.click(screen.getByRole('button', { name: t('auth.setup.submit') }))
		expect(await screen.findByText(t('auth.validation.setup-token-min'))).toBeInTheDocument()

		await expectNoViolations(container)

		// Already-configured state exposes clear redirects to sign-in & sign-up
		rerender(<SetupForm needsSetup={false} onComplete={vi.fn()} />)
		expect(screen.getByText(t('auth.setup.already-configured.title'))).toBeInTheDocument()
		expect(screen.getByRole('link', { name: t('auth.sign-in.title') })).toHaveAttribute('href', '/sign-in')
		expect(screen.getByRole('link', { name: t('auth.sign-up.title') })).toHaveAttribute('href', '/sign-up')
		await expectNoViolations(container)
	})

	it('OnboardingForm supports workspace creation + invite tabs and passes axe', async () => {
		const { calls } = stubApiAdapter(() => ({ data: { id: 'ws-1', slug: 'acme', name: 'Acme' } }))

		const onComplete = vi.fn()
		const { container } = render(
			<OnboardingForm
				user={{ id: 'u-1', email: 'ada@huriro.dev', name: 'Ada' }}
				onComplete={onComplete}
				onSignOut={async () => {}}
			/>
		)

		fireEvent.input(screen.getByLabelText(t('auth.workspace-name')), { target: { value: 'Acme Labs' } })
		expect((screen.getByLabelText(t('auth.workspace-slug')) as HTMLInputElement).value).toBe('acme-labs')

		fireEvent.click(screen.getByRole('button', { name: t('auth.onboarding.create-submit') }))
		await waitFor(() => expect(onComplete).toHaveBeenCalled())
		const createCall = calls.find((c) => c.url === '/api/v1/workspaces')
		expect(createCall?.method).toBe('post')
		expect(JSON.parse(String(createCall?.data))).toEqual({ name: 'Acme Labs', slug: 'acme-labs' })

		await expectNoViolations(container)
	})

	it('isAllowedOnboardingPath admits /setup only while bootstrap is pending', () => {
		expect(isAllowedOnboardingPath('/onboarding', false)).toBe(true)
		expect(isAllowedOnboardingPath('/onboarding', true)).toBe(true)
		expect(isAllowedOnboardingPath('/setup', true)).toBe(true)
		expect(isAllowedOnboardingPath('/setup', false)).toBe(false)
		expect(isAllowedOnboardingPath('/sign-in', true)).toBe(false)
		expect(isAllowedOnboardingPath('/tasks', true)).toBe(false)
	})

	it('OnboardingForm shows first-run setup CTA when needsSetup is true and passes axe', async () => {
		const onNavigate = vi.fn()
		const { container } = render(
			<AuthFlowProvider
				value={{
					needsSetup: true,
					socialProviders: [],
					onboardingUser: { id: 'u-1', email: 'ada@huriro.dev', name: 'Ada' },
					onAuthenticated: vi.fn(),
					onUsePreview: vi.fn(),
					onSignOut: async () => {},
					onNavigate
				}}
			>
				<OnboardingForm
					user={{ id: 'u-1', email: 'ada@huriro.dev', name: 'Ada' }}
					needsSetup
					redirectTo="/tasks"
					onComplete={vi.fn()}
					onSignOut={async () => {}}
				/>
			</AuthFlowProvider>
		)

		expect(screen.getByText(t('auth.onboarding.setup-required'))).toBeInTheDocument()
		const setupLink = screen.getByRole('link', { name: t('auth.sign-in.setup-link') })
		expect(setupLink).toHaveAttribute('href', '/setup?redirect=%2Ftasks')
		fireEvent.click(setupLink)
		expect(onNavigate).toHaveBeenCalledWith('/setup', { redirect: '/tasks' })

		await expectNoViolations(container)
	})

	it('SetupForm pre-fills signedInUser fields and exposes sign-out cleanly', async () => {
		const onSignOut = vi.fn(async () => {})
		const { container } = render(
			<SetupForm
				needsSetup
				signedInUser={{ id: 'u-1', email: 'ada@huriro.dev', name: 'Ada Lovelace' }}
				hideSwitchPrompt
				onComplete={vi.fn()}
				onSignOut={onSignOut}
			/>
		)

		expect(
			screen.getByText(t('auth.onboarding.signed-in-as', { email: 'ada@huriro.dev' }))
		).toBeInTheDocument()
		expect((screen.getByLabelText(t('auth.display-name')) as HTMLInputElement).value).toBe('Ada Lovelace')
		expect((screen.getByLabelText(t('auth.email')) as HTMLInputElement).value).toBe('ada@huriro.dev')

		fireEvent.click(screen.getByRole('button', { name: t('auth.sign-out') }))
		await waitFor(() => expect(onSignOut).toHaveBeenCalled())

		await expectNoViolations(container)
	})

	it('SignUpForm blocks account creation while needsSetup is true and passes axe', async () => {
		const onNavigate = vi.fn()
		const { container } = render(
			<AuthFlowProvider
				value={{
					needsSetup: true,
					socialProviders: ['google'],
					onboardingUser: null,
					onAuthenticated: vi.fn(),
					onUsePreview: vi.fn(),
					onSignOut: async () => {},
					onNavigate
				}}
			>
				<SignUpForm needsSetup redirectTo="/docs" onComplete={vi.fn()} />
			</AuthFlowProvider>
		)

		expect(screen.getByText(t('auth.sign-up.setup-required'))).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: t('auth.sign-up.submit') })).not.toBeInTheDocument()
		expect(screen.getByRole('link', { name: t('auth.sign-in.setup-link') })).toHaveAttribute(
			'href',
			'/setup?redirect=%2Fdocs'
		)
		expect(screen.getByRole('link', { name: t('auth.sign-in.title') })).toHaveAttribute(
			'href',
			'/sign-in?redirect=%2Fdocs'
		)

		await expectNoViolations(container)
	})
})
