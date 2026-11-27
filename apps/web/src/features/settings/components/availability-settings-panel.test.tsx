import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPreviewWorkspace } from '@/lib/preview-workspace'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { AvailabilitySettingsPanel } from './availability-settings-panel'

describe('AvailabilitySettingsPanel', () => {
	beforeAll(async () => {
		await activateI18n('en')
	})

	afterEach(() => {
		cleanup()
	})

	it('renders loading skeleton while pending and an actionable error notice on load failure', async () => {
		const boot = await createPreviewWorkspace()
		try {
			let rejectProfile!: (err: Error) => void
			const pendingProfile = new Promise<never>((_, reject) => {
				rejectProfile = reject
			})
			const failingWorkspace = {
				...boot,
				api: {
					...boot.api,
					getMyAvailability: vi.fn(() => pendingProfile)
				}
			}

			// Seeded replica row is cleared first so initial pending state shows skeleton rather than blank screen
			boot.engine.collections.userAvailabilityManaged.replaceAll([])

			const { container } = render(
				<WorkspaceProvider boot={failingWorkspace}>
					<SyncProvider engine={boot.engine}>
						<AvailabilitySettingsPanel />
					</SyncProvider>
				</WorkspaceProvider>
			)

			expect(container.querySelector('.animate-pulse')).not.toBeNull()

			rejectProfile(new Error('Network unavailable'))
			await waitFor(() => {
				expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable')
			})
			expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})

	it('hydrates from REST when replica starts empty and saves status override, presets, and DND timers', async () => {
		const boot = await createPreviewWorkspace()
		try {
			// Simulate legacy cached replica where userAvailability collection is initially empty
			boot.engine.collections.userAvailabilityManaged.replaceAll([])

			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<AvailabilitySettingsPanel />
					</SyncProvider>
				</WorkspaceProvider>
			)

			expect(await screen.findByRole('heading', { name: 'Status & presence override' })).toBeInTheDocument()
			expect(screen.getByRole('heading', { name: 'Weekly working hours' })).toBeInTheDocument()
			expect(screen.getByRole('heading', { name: 'Scheduled out-of-office & focus' })).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: /Busy/i }))
			fireEvent.click(screen.getByRole('button', { name: /Deep focus/i }))
			fireEvent.click(screen.getByRole('checkbox', { name: /Pause push and email outside working hours/i }))
			fireEvent.click(screen.getByRole('button', { name: 'Save status & preferences' }))

			await waitFor(async () => {
				const mine = await boot.api.getMyAvailability()
				expect(mine.manualState).toBe('busy')
				expect(mine.statusText).toBe('Deep focus')
				expect(mine.suppressNotificationsOffHours).toBe(true)
			})

			fireEvent.click(screen.getByRole('button', { name: '30m DND' }))
			await waitFor(() => {
				expect(screen.getByText(/Paused until/i)).toBeInTheDocument()
			})

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('preserves time-input focus on edits, validates overlapping split shifts, and saves working hours', async () => {
		const boot = await createPreviewWorkspace()
		try {
			render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<AvailabilitySettingsPanel />
					</SyncProvider>
				</WorkspaceProvider>
			)

			expect(await screen.findByRole('heading', { name: 'Weekly working hours' })).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Mon–Fri 09:00–17:00' }))
			const monStart = screen.getByLabelText('Monday start 1') as HTMLInputElement
			monStart.focus()
			fireEvent.change(monStart, { target: { value: '08:30' } })
			fireEvent.change(monStart, { target: { value: '08:00' } })
			expect(screen.getByLabelText('Monday start 1')).toBe(monStart)
			expect(document.activeElement).toBe(monStart)

			const firstAddButton = screen.getAllByRole('button', { name: 'Add interval' })[0]
			expect(firstAddButton).toBeDefined()
			if (firstAddButton) fireEvent.click(firstAddButton)
			const monStart2 = screen.getByLabelText('Monday start 2') as HTMLInputElement
			expect(monStart2.value).toBe('13:00')
			const monEnd1 = screen.getByLabelText('Monday end 1') as HTMLInputElement
			fireEvent.change(monEnd1, { target: { value: '14:00' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save working hours' }))
			expect(await screen.findByRole('alert')).toHaveTextContent(/overlap/i)

			fireEvent.change(monEnd1, { target: { value: '12:00' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save working hours' }))
			await waitFor(async () => {
				const mine = await boot.api.getMyAvailability()
				expect(mine.workingHours.enabled).toBe(true)
				expect(mine.workingHours.days.mon).toEqual([
					{ start: '08:00', end: '12:00' },
					{ start: '13:00', end: '17:00' }
				])
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('creates, edits, and deletes scheduled windows with non-self backup delegates', async () => {
		const boot = await createPreviewWorkspace()
		try {
			render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<AvailabilitySettingsPanel />
					</SyncProvider>
				</WorkspaceProvider>
			)

			expect(
				await screen.findByRole('heading', { name: 'Scheduled out-of-office & focus' })
			).toBeInTheDocument()

			fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Summer break' } })
			fireEvent.click(screen.getByRole('combobox', { name: 'Backup teammate' }))
			const delegateOptions = await screen.findAllByRole('option')
			expect(delegateOptions.some((el) => /Hagen/.test(el.textContent ?? ''))).toBe(false)
			const nonOwnerDelegate = delegateOptions.find((el) =>
				/· member|· admin|· owner/i.test(el.textContent ?? '')
			)
			expect(nonOwnerDelegate).toBeDefined()
			if (nonOwnerDelegate) fireEvent.click(nonOwnerDelegate)

			fireEvent.click(screen.getByRole('button', { name: 'Schedule a window' }))
			expect(await screen.findByText('Summer break')).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: /Edit window Summer break/i }))
			fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Extended break' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
			expect(await screen.findByText('Extended break')).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: /Delete window Extended break/i }))
			await waitFor(() => {
				expect(screen.getByText('No scheduled windows yet.')).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
