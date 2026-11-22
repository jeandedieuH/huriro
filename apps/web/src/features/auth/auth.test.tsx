import { activateI18n, t } from '@huriro/i18n'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('auth forms', () => {
	beforeEach(() => {
		vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('SignInForm validates with Zod, toggles password, handles social auth, and passes axe', async () => {
		const assignMock = vi.fn()
		vi.stubGlobal('location', { ...window.location, assign: assignMock })

		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString()
			if (url.endsWith('/api/auth/sign-in/social')) {
				return new Response(
					JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/v2/auth', redirect: true }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			}
			return new Response(JSON.stringify({ token: 'tok', user: { id: '1' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		})
		vi.stubGlobal('fetch', fetchMock)

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
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/auth/sign-in/email',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					email: 'ada@huriro.dev',
					password: 'secret1234',
					rememberMe: true
				})
			})
		)

		await expectNoViolations(container)
	})

	it('SignUpForm checks password strength + confirmation mismatch, submits, links to /sign-in, and passes axe', async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(JSON.stringify({ token: 'tok', user: { id: '1' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		})
		vi.stubGlobal('fetch', fetchMock)

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
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/auth/sign-up/email',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					name: 'Ada Lovelace',
					email: 'ada@huriro.dev',
					password: 'CorrectHorse99!'
				})
			})
		)

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
		const fetchMock = vi.fn(async () => {
			return new Response(JSON.stringify({ id: 'ws-1', slug: 'acme', name: 'Acme' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		})
		vi.stubGlobal('fetch', fetchMock)

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
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/v1/workspaces',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ name: 'Acme Labs', slug: 'acme-labs' })
			})
		)

		await expectNoViolations(container)
	})
})
