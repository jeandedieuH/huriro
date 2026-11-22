import { createHuriroExtensions } from '@huriro/editor'
import { activateI18n } from '@huriro/i18n'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { describe, expect, it } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { getSlashItems } from './slash-items'

activateI18n('en')

function renderTestEditor(editable = true) {
	const editor = new Editor({
		editable,
		extensions: createHuriroExtensions({ collaborative: false }),
		content: '<p></p>'
	})
	const rendered = render(<EditorContent editor={editor} />)
	return { editor, ...rendered }
}

function findSlashItem(id: string) {
	const item = getSlashItems().find((entry) => entry.id === id)
	if (!item) throw new Error(`Slash item ${id} not found`)
	return item
}

describe('editor blocks', () => {
	it('inserts bullet and numbered lists that render real list markers', async () => {
		const { editor, unmount } = renderTestEditor()
		try {
			await act(async () => {
				findSlashItem('bullet').apply(editor)
			})
			expect(editor.getJSON().content?.[0]?.type).toBe('bulletList')
			expect(document.querySelector('.ProseMirror ul li')).not.toBeNull()

			await act(async () => {
				editor.commands.setContent('<p></p>')
			})
			await act(async () => {
				findSlashItem('ordered').apply(editor)
			})
			expect(editor.getJSON().content?.[0]?.type).toBe('orderedList')
			expect(document.querySelector('.ProseMirror ol li')).not.toBeNull()
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('renders a collapsible toggle whose arrow flips open state and hides content', async () => {
		const { editor, unmount } = renderTestEditor()
		try {
			await act(async () => {
				findSlashItem('toggle').apply(editor)
			})

			const toggleNode = editor.getJSON().content?.[0]
			expect(toggleNode?.type).toBe('toggle')
			expect(toggleNode?.attrs?.['open']).toBe(true)

			const toggleDom = document.querySelector('[data-toggle]')
			const arrow = screen.getByRole('button', { name: 'Toggle collapsible section' })
			const content = toggleDom?.querySelector('[data-toggle-content]')
			expect(toggleDom).not.toBeNull()
			expect(content).not.toBeNull()

			// Arrow click collapses the block — data-open flips and content hides.
			await act(async () => {
				fireEvent.click(arrow)
			})
			expect(editor.getJSON().content?.[0]?.attrs?.['open']).toBe(false)
			expect(toggleDom?.getAttribute('data-open')).toBe('false')
			expect(arrow.getAttribute('aria-expanded')).toBe('false')
			expect((content as HTMLElement).hidden).toBe(true)

			// Click again reopens it.
			await act(async () => {
				fireEvent.click(arrow)
			})
			expect(editor.getJSON().content?.[0]?.attrs?.['open']).toBe(true)
			expect((content as HTMLElement).hidden).toBe(false)

			await expectNoViolations(toggleDom as Element)
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('updates the toggle summary via its header input', async () => {
		const { editor, unmount } = renderTestEditor()
		try {
			await act(async () => {
				findSlashItem('toggle').apply(editor)
			})

			const summaryInput = screen.getByLabelText('Collapsible section title')
			await act(async () => {
				fireEvent.change(summaryInput, { target: { value: 'Release notes' } })
			})
			expect(editor.getJSON().content?.[0]?.attrs?.['summary']).toBe('Release notes')
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('does not collapse a toggle in a read-only editor', async () => {
		const { editor, unmount } = renderTestEditor(false)
		try {
			await act(async () => {
				editor.commands.setContent({
					type: 'doc',
					content: [
						{ type: 'toggle', attrs: { summary: 'Details', open: true }, content: [{ type: 'paragraph' }] }
					]
				})
			})

			const arrow = screen.getByRole('button', { name: 'Toggle collapsible section' })
			await act(async () => {
				fireEvent.click(arrow)
			})
			expect(editor.getJSON().content?.[0]?.attrs?.['open']).toBe(true)
		} finally {
			unmount()
			editor.destroy()
		}
	})
})
