import { createHuriroExtensions } from '@huriro/editor'
import { activateI18n } from '@huriro/i18n'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { describe, expect, it } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { FloatingToolbar } from './floating-toolbar'
import { getSlashItems } from './slash-items'

activateI18n('en')

// The toolbar reads editor state during render, so tests re-render after clicks
// to observe freshly computed aria-pressed values. The tree must be rebuilt —
// re-rendering the same element reference makes React bail out.
function renderToolbar(editable = true) {
	const editor = new Editor({
		editable,
		extensions: createHuriroExtensions({ collaborative: false }),
		content: '<p>hello</p>'
	})
	const tree = () => (
		<>
			<FloatingToolbar editor={editor} canWrite={editable} canComment={true} onAddComment={() => {}} />
			<EditorContent editor={editor} />
		</>
	)
	const rendered = render(tree())
	return {
		editor,
		...rendered,
		sync: () => rendered.rerender(tree())
	}
}

describe('floating toolbar', () => {
	it('exposes every insertable block as a flat toolbar button — no popover', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			for (const item of getSlashItems()) {
				expect(screen.getByRole('button', { name: item.label })).toBeInTheDocument()
			}
			// The retired "Insert block" popover trigger must not exist.
			expect(screen.queryByRole('button', { name: 'Insert block' })).not.toBeInTheDocument()

			// axe scopes to the toolbar itself — the editor's aria-label is set by
			// the production shell (editorProps), not by this component.
			const toolbar = screen.getByRole('toolbar')
			await expectNoViolations(toolbar)
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('applies a toggle-type block and reflects it in aria-pressed', async () => {
		const { editor, unmount, sync } = renderToolbar()
		try {
			const bullet = screen.getByRole('button', { name: 'Bulleted list' })
			expect(bullet).toHaveAttribute('aria-pressed', 'false')

			await act(async () => {
				fireEvent.click(bullet)
			})
			expect(editor.getJSON().content?.[0]?.type).toBe('bulletList')

			sync()
			expect(screen.getByRole('button', { name: 'Bulleted list' })).toHaveAttribute('aria-pressed', 'true')
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('inserts action blocks without aria-pressed semantics', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			const divider = screen.getByRole('button', { name: 'Divider' })
			expect(divider).not.toHaveAttribute('aria-pressed')

			await act(async () => {
				fireEvent.click(divider)
			})
			expect(editor.getJSON().content?.some((node) => node.type === 'horizontalRule')).toBe(true)

			const table = screen.getByRole('button', { name: 'Table (3×3)' })
			expect(table).not.toHaveAttribute('aria-pressed')
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('hides all write tools in read-only mode but keeps comment', () => {
		const { editor, unmount } = renderToolbar(false)
		try {
			expect(screen.queryByRole('button', { name: 'Bulleted list' })).not.toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument()
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('edits the link URL in a popover anchored to the link button, not inline in the toolbar', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			// Select "hello" so the applied link has a range to wrap.
			await act(async () => {
				editor.commands.setTextSelection({ from: 1, to: 6 })
			})
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Link URL' }))
			})

			// The input must live in the popover — outside the toolbar element.
			const input = await screen.findByRole('textbox', { name: 'Link URL' })
			const toolbar = screen.getByRole('toolbar')
			expect(toolbar.contains(input)).toBe(false)

			await act(async () => {
				fireEvent.change(input, { target: { value: 'https://huriro.app' } })
				fireEvent.keyDown(input, { key: 'Enter' })
			})

			const text = editor.getJSON().content?.[0]?.content?.[0]
			expect(text?.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://huriro.app' } })
			// Popover closes after applying.
			expect(screen.queryByRole('textbox', { name: 'Link URL' })).not.toBeInTheDocument()
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('inserts the URL as visible linked text when the cursor is collapsed outside any link', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			// Collapsed cursor at the end of "hello" — this is the case where a bare
			// setLink would store an invisible mark and insert nothing.
			await act(async () => {
				editor.commands.setTextSelection(6)
			})
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Link URL' }))
			})
			const input = await screen.findByRole('textbox', { name: 'Link URL' })
			await act(async () => {
				fireEvent.change(input, { target: { value: 'https://huriro.app/docs' } })
				fireEvent.keyDown(input, { key: 'Enter' })
			})

			const nodes = editor.getJSON().content?.[0]?.content ?? []
			const inserted = nodes.find((node) => 'text' in node && node.text === 'https://huriro.app/docs')
			expect(inserted?.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://huriro.app/docs' } })
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('rejects an unsafe URL with an inline error and applies nothing', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			await act(async () => {
				editor.commands.setTextSelection({ from: 1, to: 6 })
			})
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Link URL' }))
			})
			const input = await screen.findByRole('textbox', { name: 'Link URL' })
			await act(async () => {
				fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
				fireEvent.keyDown(input, { key: 'Enter' })
			})

			expect(screen.getByRole('alert')).toHaveTextContent('This link is not safe')
			expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toBeUndefined()
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('prefills the popover with the existing href when the cursor sits on a link', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			await act(async () => {
				editor
					.chain()
					.setTextSelection({ from: 1, to: 6 })
					.setLink({ href: 'https://existing.example' })
					.run()
			})
			await act(async () => {
				editor.commands.setTextSelection(3)
			})
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Link URL' }))
			})
			const input = (await screen.findByRole('textbox', { name: 'Link URL' })) as HTMLInputElement
			expect(input.value).toBe('https://existing.example')
		} finally {
			unmount()
			editor.destroy()
		}
	})
})
