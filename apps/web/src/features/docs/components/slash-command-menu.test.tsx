import { createHuriroExtensions } from '@huriro/editor'
import { activateI18n } from '@huriro/i18n'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { describe, expect, it } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { createSlashCommandExtension } from './slash-command-menu'

activateI18n('en')

// ReactRenderer mounts through the editor's contentComponent, so the menu only
// exists once EditorContent is attached — same as the production shell.
function renderTestEditor() {
	const editor = new Editor({
		extensions: [...createHuriroExtensions({ collaborative: false }), createSlashCommandExtension()],
		content: '<p></p>'
	})
	const rendered = render(<EditorContent editor={editor} />)
	return { editor, ...rendered }
}

async function type(editor: Editor, text: string) {
	await act(async () => {
		editor.commands.insertContent(text)
	})
}

describe('slash command menu', () => {
	it('opens the block picker when "/" is typed and inserts the highlighted block on Enter', async () => {
		const { editor, unmount } = renderTestEditor()
		try {
			await type(editor, '/')

			await waitFor(() => {
				expect(screen.getByRole('listbox', { name: 'Insert block' })).toBeInTheDocument()
			})

			// First option is "Heading 1" — Enter deletes the "/" and applies it.
			const proseMirror = document.querySelector('.ProseMirror')
			expect(proseMirror).not.toBeNull()
			await act(async () => {
				fireEvent.keyDown(proseMirror as Element, { key: 'Enter' })
			})

			expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
			expect(editor.getJSON().content?.[0]?.type).toBe('heading')
			expect(editor.getText()).not.toContain('/')
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('filters items by the query typed after "/"', async () => {
		const { editor, unmount } = renderTestEditor()
		try {
			await type(editor, '/head')

			await waitFor(() => {
				expect(screen.getAllByRole('option').length).toBe(6)
			})
			expect(screen.getByRole('option', { name: 'Heading 1' })).toBeInTheDocument()
			expect(screen.getByRole('option', { name: 'Toggle Heading 1' })).toBeInTheDocument()
			expect(screen.queryByRole('option', { name: 'Table (3×3)' })).not.toBeInTheDocument()

			const listbox = screen.getByRole('listbox')
			await expectNoViolations(listbox)
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('selects a block on click', async () => {
		const { editor, unmount } = renderTestEditor()
		try {
			await type(editor, '/tab')

			const option = await waitFor(() => screen.getByRole('option', { name: 'Table (3×3)' }))
			await act(async () => {
				fireEvent.click(option)
			})

			expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
			const firstNode = editor.getJSON().content?.[0]
			expect(firstNode?.type).toBe('table')
		} finally {
			unmount()
			editor.destroy()
		}
	})
})
