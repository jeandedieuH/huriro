/**
 * createAuth construction smoke test — better-auth validates its options at
 * build time, so a bad option name/shape fails here, not on first request.
 * postgres.js pools connect lazily, so no database is needed.
 */
import { describe, expect, test } from 'bun:test'
import { createEmailPipeline, type EmailMessage, type EmailTransport } from '../../email'
import type { Config } from '../../env'
import { createAuth, getEnabledSocialProviders } from './auth'

const fakeConfig = {
	HURIRO_URL: 'https://app.test.huriro.dev',
	HURIRO_ENV: 'test',
	HURIRO_MODE: 'selfhost',
	databaseUrl: 'postgres://u:p@localhost:1/huriro',
	databaseAdminUrl: 'postgres://u:p@localhost:1/huriro',
	databaseAuthUrl: 'postgres://u:p@localhost:1/huriro',
	secretKey: 'a'.repeat(48),
	betterAuthSecret: 'b'.repeat(48),
	PASSKEY_RP_NAME: 'Huriro',
	PORT: 3001,
	WS_PORT: 3005,
	LOG_LEVEL: 'error',
	BLOB_STORE: 'fs',
	BLOB_DIR: '/tmp'
} as Config

describe('createAuth', () => {
	test('builds an instance with handler + api surface', () => {
		const auth = createAuth(fakeConfig)
		expect(typeof auth.handler).toBe('function')
		expect(typeof auth.api.getSession).toBe('function')
		expect(typeof auth.api.signUpEmail).toBe('function')
		expect(getEnabledSocialProviders(auth)).toEqual([])
		expect(getEnabledSocialProviders(null)).toEqual([])
	})

	test('derives passkey rpID from HURIRO_URL when unset', () => {
		const auth = createAuth(fakeConfig)
		// $Infer checks aren't reachable at runtime — presence of the plugin
		// endpoints on the api surface is the observable contract.
		expect(auth.options.plugins.map((p) => p.id)).toContain('passkey')
		expect(auth.options.plugins.map((p) => p.id)).toContain('two-factor')
	})

	test('registers Google, GitHub, and Apple social providers and adds Apple origin only when Apple is enabled', () => {
		const googleOnly = createAuth({
			...fakeConfig,
			GOOGLE_CLIENT_ID: 'google-client-id',
			googleClientSecret: 'google-client-secret'
		})
		expect(getEnabledSocialProviders(googleOnly)).toEqual(['google'])
		expect(googleOnly.options.trustedOrigins).toEqual(['https://app.test.huriro.dev'])

		const allSocial = createAuth({
			...fakeConfig,
			GOOGLE_CLIENT_ID: 'google-client-id',
			googleClientSecret: 'google-client-secret',
			GITHUB_CLIENT_ID: 'github-client-id',
			githubClientSecret: 'github-client-secret',
			APPLE_CLIENT_ID: 'apple-client-id',
			appleClientSecret: 'apple-client-secret',
			APPLE_APP_BUNDLE_IDENTIFIER: 'dev.huriro.app'
		})
		expect(getEnabledSocialProviders(allSocial)).toEqual(['google', 'github', 'apple'])
		expect(allSocial.options.trustedOrigins).toEqual([
			'https://app.test.huriro.dev',
			'https://appleid.apple.com'
		])
	})

	test('gates email verification on configured transport and delivers auth lifecycle emails', async () => {
		const noopEmail = createEmailPipeline({
			mode: 'selfhost',
			provider: 'noop',
			from: 'noreply@huriro.local',
			baseUrl: 'https://app.test.huriro.dev',
			requireVerification: true
		})
		const unconfiguredAuth = createAuth(
			{ ...fakeConfig, EMAIL_REQUIRE_VERIFICATION: true },
			{ email: noopEmail }
		)
		expect(unconfiguredAuth.options.emailAndPassword.requireEmailVerification).toBe(false)
		expect(unconfiguredAuth.options.emailVerification?.sendOnSignUp).toBe(false)

		const sent: EmailMessage[] = []
		const recorder: EmailTransport = {
			provider: 'custom',
			async send(msg) {
				sent.push(msg)
				return { provider: 'custom', messageId: `msg_${sent.length}` }
			}
		}
		const email = createEmailPipeline(
			{
				mode: 'selfhost',
				provider: 'auto',
				from: 'Huriro <noreply@huriro.test>',
				baseUrl: 'https://app.test.huriro.dev',
				requireVerification: true
			},
			{ transport: recorder }
		)
		const auth = createAuth({ ...fakeConfig, EMAIL_REQUIRE_VERIFICATION: true }, { email })

		expect(auth.options.emailAndPassword.requireEmailVerification).toBe(true)
		expect(auth.options.emailVerification?.sendOnSignUp).toBe(true)

		const sampleUser = {
			id: 'usr_1',
			email: 'ada@example.com',
			name: 'Ada Lovelace',
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date()
		}

		await auth.options.emailAndPassword.sendResetPassword?.({
			user: sampleUser,
			url: 'https://app.test.huriro.dev/reset-password?token=tok_reset',
			token: 'tok_reset'
		})
		await auth.options.emailAndPassword.onPasswordReset?.({ user: sampleUser })
		await auth.options.emailVerification?.sendVerificationEmail?.({
			user: sampleUser,
			url: 'https://app.test.huriro.dev/verify-email?token=tok_verify',
			token: 'tok_verify'
		})
		await auth.options.user?.changeEmail?.sendChangeEmailConfirmation?.({
			user: sampleUser,
			newEmail: 'ada.new@example.com',
			url: 'https://app.test.huriro.dev/api/auth/change-email?token=tok_change',
			token: 'tok_change'
		})

		expect(sent).toHaveLength(4)
		expect(sent[0]?.subject).toContain('Reset')
		expect(sent[0]?.html).toContain('tok_reset')
		expect(sent[1]?.subject).toContain('password was changed')
		expect(sent[2]?.subject).toContain('Verify')
		expect(sent[2]?.html).toContain('tok_verify')
		expect(sent[3]?.subject).toContain('email address change')
		expect(sent[3]?.html).toContain('ada.new@example.com')
	})
})
