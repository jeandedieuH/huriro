import { activateI18n, t } from '@huriro/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthFlowProvider } from '../context'
import { AuthLayout } from './auth-layout'
import { OnboardingForm } from './onboarding-form'
import { SetupForm, SetupSwitchPrompt } from './setup-form'
import { SignInForm, SignInSwitchPrompt } from './sign-in-form'
import { SignUpForm, SignUpSwitchPrompt } from './sign-up-form'

activateI18n('en')

const meta: Meta<typeof SignInForm> = {
	title: 'Auth/Flows',
	component: SignInForm
}
export default meta
type Story = StoryObj<typeof SignInForm>

export const SignIn: Story = {
	render: () => (
		<AuthFlowProvider
			value={{
				needsSetup: false,
				socialProviders: ['google', 'github', 'apple'],
				onboardingUser: null,
				onAuthenticated: fn(),
				onUsePreview: fn(),
				onSignOut: async () => {},
				onNavigate: fn()
			}}
		>
			<AuthLayout
				title={t('auth.sign-in.title')}
				subtitle={t('auth.sign-in.subtitle')}
				footer={<SignInSwitchPrompt />}
				onUsePreview={fn()}
			>
				<SignInForm socialProviders={['google', 'github', 'apple']} hideSwitchPrompt onComplete={fn()} />
			</AuthLayout>
		</AuthFlowProvider>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('button', { name: /google/i })).toBeVisible()
		await expect(canvas.getByRole('button', { name: /github/i })).toBeVisible()
		await expect(canvas.getByRole('button', { name: /apple/i })).toBeVisible()
		const submit = canvas.getByRole('button', { name: t('auth.sign-in.submit') })
		await userEvent.click(submit)
		await expect(await canvas.findByText(t('auth.validation.email-required'))).toBeVisible()
	}
}

export const SignInWithSocialProviders: Story = {
	render: () => (
		<AuthLayout
			title={t('auth.sign-in.title')}
			subtitle={t('auth.sign-in.subtitle')}
			footer={<SignInSwitchPrompt />}
		>
			<SignInForm socialProviders={['google', 'github']} needsSetup hideSwitchPrompt onComplete={fn()} />
		</AuthLayout>
	)
}

export const SignUp: Story = {
	render: () => (
		<AuthLayout
			title={t('auth.sign-up.title')}
			subtitle={t('auth.sign-up.subtitle')}
			footer={<SignUpSwitchPrompt />}
			onUsePreview={fn()}
		>
			<SignUpForm socialProviders={['google', 'github', 'apple']} hideSwitchPrompt onComplete={fn()} />
		</AuthLayout>
	)
}

export const FirstRunSetup: Story = {
	render: () => (
		<AuthLayout
			title={t('auth.setup.title')}
			subtitle={t('auth.setup.subtitle')}
			wide
			footer={<SetupSwitchPrompt />}
		>
			<SetupForm needsSetup hideSwitchPrompt onComplete={fn()} />
		</AuthLayout>
	)
}

export const SetupAlreadyConfigured: Story = {
	render: () => (
		<AuthLayout title={t('auth.setup.title')} subtitle={t('auth.setup.subtitle')} wide>
			<SetupForm needsSetup={false} hideSwitchPrompt onComplete={fn()} />
		</AuthLayout>
	)
}

export const WorkspaceOnboarding: Story = {
	render: () => (
		<AuthLayout title={t('auth.onboarding.title')} subtitle={t('auth.onboarding.subtitle')}>
			<OnboardingForm
				user={{ id: '0190a0b1-0000-7000-8000-000000000001', email: 'ada@huriro.dev', name: 'Ada' }}
				onComplete={fn()}
				onSignOut={async () => {}}
			/>
		</AuthLayout>
	)
}
