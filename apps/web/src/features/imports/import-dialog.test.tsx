import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { ImportDialog } from './components/import-dialog'

activateI18n('en')

describe('ImportDialog', () => {
	beforeEach(() => {
		useUiStore.setState({ importDialogOpen: true, toasts: [] })
	})

	it('previews dry-run counts and executes Linear import with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<SyncProvider engine={boot.engine}>
					<ImportDialog api={boot.api} />
				</SyncProvider>
			)
			await expectNoViolations(container)

			fireEvent.click(screen.getByRole('button', { name: 'Dry-run preview' }))
			await waitFor(() => {
				expect(screen.getByText(/Ready: 1 tasks, 0 comments \(0 skipped\)/)).toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Run import' }))
			await waitFor(() => {
				expect(screen.getByText(/Imported 1 tasks and 0 comments/)).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('previews and executes Slack JSON channel & thread import', async () => {
		const boot = await createPreviewWorkspace()
		try {
			render(
				<SyncProvider engine={boot.engine}>
					<ImportDialog api={boot.api} />
				</SyncProvider>
			)

			fireEvent.click(screen.getByRole('combobox', { name: 'Source' }))
			fireEvent.click(await screen.findByRole('option', { name: 'Slack JSON export' }))

			const slackPayload = JSON.stringify({
				channels: [{ id: 'C01', name: 'ops', topic: 'Operations' }],
				messagesByChannel: {
					C01: [
						{ ts: '1700000001.000100', user: 'ada@huriro.local', text: 'Runbook check' },
						{
							ts: '1700000002.000100',
							threadTs: '1700000001.000100',
							user: 'hagen@huriro.local',
							text: 'Thread reply'
						}
					]
				}
			})
			fireEvent.change(screen.getByLabelText('Export payload'), { target: { value: slackPayload } })

			fireEvent.click(screen.getByRole('button', { name: 'Dry-run preview' }))
			await waitFor(() => {
				expect(
					screen.getByText(/Ready: 1 channels, 1 messages, 1 thread replies \(0 skipped\)/)
				).toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Run import' }))
			await waitFor(() => {
				expect(screen.getByText(/Imported 1 channels and [12] messages/)).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('previews and executes Jira CSV import', async () => {
		const boot = await createPreviewWorkspace()
		try {
			render(
				<SyncProvider engine={boot.engine}>
					<ImportDialog api={boot.api} />
				</SyncProvider>
			)

			fireEvent.click(screen.getByRole('combobox', { name: 'Source' }))
			fireEvent.click(await screen.findByRole('option', { name: 'Jira (CSV or JSON)' }))

			const jiraCsv = [
				'Issue key,Summary,Description,Priority,Status',
				'OPS-42,Rotate backup keys,Verify KMS rotation,High,Todo'
			].join('\n')
			fireEvent.change(screen.getByLabelText('Export payload'), { target: { value: jiraCsv } })

			fireEvent.click(screen.getByRole('button', { name: 'Dry-run preview' }))
			await waitFor(() => {
				expect(screen.getByText(/Ready: 1 tasks, 0 comments \(0 skipped\)/)).toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Run import' }))
			await waitFor(() => {
				expect(screen.getByText(/Imported 1 tasks and 0 comments/)).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
