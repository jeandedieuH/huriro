import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodResolver } from './zod-resolver'

describe('zodResolver', () => {
	const schema = z
		.object({
			email: z.string().trim().min(1, 'Email required').pipe(z.email('Invalid email')),
			password: z.string().min(8, 'Password too short'),
			confirmPassword: z.string().min(1, 'Confirm required'),
			profile: z.object({
				name: z.string().trim().min(2, 'Name too short')
			})
		})
		.refine((data) => data.password === data.confirmPassword, {
			path: ['confirmPassword'],
			message: 'Passwords mismatch'
		})

	type FormValues = z.infer<typeof schema>
	const resolver = zodResolver(schema)

	it('returns parsed and transformed values when valid', async () => {
		const result = await resolver(
			{
				email: '  ada@huriro.dev  ',
				password: 'secret-password',
				confirmPassword: 'secret-password',
				profile: { name: '  Ada  ' }
			},
			undefined,
			{ criteriaMode: 'firstError', fields: {}, shouldUseNativeValidation: false }
		)
		expect(result.errors).toEqual({})
		expect(result.values).toEqual({
			email: 'ada@huriro.dev',
			password: 'secret-password',
			confirmPassword: 'secret-password',
			profile: { name: 'Ada' }
		})
	})

	it('maps missing, invalid, nested, and cross-field refinement errors', async () => {
		const result = await resolver(
			{
				email: 'bad-email',
				password: 'short',
				confirmPassword: 'different-password',
				profile: { name: 'A' }
			} as FormValues,
			undefined,
			{ criteriaMode: 'firstError', fields: {}, shouldUseNativeValidation: false }
		)

		expect(result.values).toEqual({})
		expect(result.errors).toMatchObject({
			email: { message: 'Invalid email' },
			password: { message: 'Password too short' },
			confirmPassword: { message: 'Passwords mismatch' },
			profile: { name: { message: 'Name too short' } }
		})
	})
})
