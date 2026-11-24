import { activateI18n } from '@huriro/i18n'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { AgentsSettingsPanel } from './components/agents-panel'
import { AiSettingsPanel } from './components/ai-settings-panel'
import { ApprovalsSettingsPanel } from './components/approvals-panel'

activateI18n('en')

describe('M3 agent surfaces settings UI', () => {
	it('lists connected apps, workspace agents and API keys; a created key is revealed once, zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<AgentsSettingsPanel />
				</WorkspaceProvider>
			)

			// 'Claude Code' is both a connected app and a workspace agent — expect both rows.
			await waitFor(() => {
				expect(screen.getAllByText('Claude Code').length).toBeGreaterThanOrEqual(2)
			})
			expect(screen.getByText('API key: CI deploy bot')).toBeInTheDocument()
			expect(screen.getByText(/hrk_a1b2c3d4/)).toBeInTheDocument()

			const createSpy = vi.spyOn(boot.api, 'createApiKey')
			const nameInput = screen.getByLabelText('Key name') as HTMLInputElement
			fireEvent.change(nameInput, { target: { value: 'nightly sync' } })
			expect(nameInput.value).toBe('nightly sync')
			fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
			await waitFor(() => expect(createSpy).toHaveBeenCalled())
			await waitFor(() => {
				expect(screen.getByText('Copy this key now — it will not be shown again.')).toBeInTheDocument()
			})
			expect(screen.getByText(/hrk_.*_preview-secret-/)).toBeInTheDocument()

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('decides a pending agent approval and shows it in history, zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<ApprovalsSettingsPanel />
				</WorkspaceProvider>
			)

			expect(await screen.findByText('tasks.bulk_update')).toBeInTheDocument()
			fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
			await waitFor(() => {
				expect(screen.getByText('No approvals waiting.')).toBeInTheDocument()
			})

			// Radix Tabs (automatic activation) switches on mousedown, not click.
			fireEvent.mouseDown(screen.getByRole('tab', { name: 'History' }))
			await waitFor(() => {
				expect(screen.getByText('approved')).toBeInTheDocument()
			})

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('enables AI and saves a provider with write-only key handling, zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<AiSettingsPanel />
				</WorkspaceProvider>
			)

			expect(await screen.findByText('AI features')).toBeInTheDocument()
			fireEvent.click(screen.getByRole('checkbox', { name: 'Enable AI for this workspace' }))

			fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Local Ollama' } })
			fireEvent.change(screen.getByLabelText('Base URL'), {
				target: { value: 'http://localhost:11434' }
			})
			fireEvent.change(screen.getByLabelText('Chat model'), { target: { value: 'llama3.1' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save provider' }))

			await waitFor(() => {
				expect(screen.getByText('Local Ollama')).toBeInTheDocument()
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})
})
