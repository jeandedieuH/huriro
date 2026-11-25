import { createHuriroExtensions } from '@huriro/editor'
import { activateI18n } from '@huriro/i18n'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { FloatingToolbar } from './floating-toolbar'

activateI18n('en')

function renderToolbar(editable = true, onAddComment = () => {}) {
	const editor = new Editor({
		editable,
		extensions: createHuriroExtensions({ collaborative: false }),
		content: '<p>hello world</p>'
	})
	const tree = () => (
		<>
			<FloatingToolbar editor={editor} canWrite={editable} canComment={true} onAddComment={onAddComment} />
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

describe('Notion selection bubble toolbar', () => {
	it('stays hidden on a collapsed cursor and appears when text is selected', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			expect(screen.queryByRole('toolbar', { name: 'Formatting toolbar' })).not.toBeInTheDocument()

			await act(async () => {
				editor.commands.setTextSelection({ from: 1, to: 6 })
			})

			const toolbar = screen.getByRole('toolbar', { name: 'Formatting toolbar' })
			expect(toolbar).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Turn into' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Underline' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Inline code' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Text & background color' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument()

			await expectNoViolations(toolbar)
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('toggles inline formatting marks and reflects aria-pressed state', async () => {
		const { editor, unmount, sync } = renderToolbar()
		try {
			await act(async () => {
				editor.commands.setTextSelection({ from: 1, to: 6 })
			})

			const bold = screen.getByRole('button', { name: 'Bold' })
			const underline = screen.getByRole('button', { name: 'Underline' })
			expect(bold).toHaveAttribute('aria-pressed', 'false')
			expect(underline).toHaveAttribute('aria-pressed', 'false')

			await act(async () => {
				fireEvent.click(bold)
				fireEvent.click(underline)
			})
			sync()

			expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
			expect(screen.getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'true')
			const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? []
			expect(marks.map((m) => m.type)).toEqual(expect.arrayContaining(['bold', 'underline']))
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('converts blocks via the Turn into menu and applies semantic block tones', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			await act(async () => {
				editor.commands.setTextSelection({ from: 1, to: 6 })
			})

			const turnIntoTrigger = screen.getByRole('button', { name: 'Turn into' })
			fireEvent.keyDown(turnIntoTrigger, { key: 'Enter' })
			const h1Item = await screen.findByRole('menuitem', { name: 'Heading 1' })
			await act(async () => {
				fireEvent.click(h1Item)
			})
			await waitFor(() => {
				expect(screen.queryByRole('menu')).not.toBeInTheDocument()
			})
			expect(editor.getJSON().content?.[0]?.type).toBe('heading')
			expect(editor.getJSON().content?.[0]?.attrs?.['level']).toBe(1)

			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Text & background color' }))
			})
			const infoBgSwatch = await screen.findByRole('button', { name: 'Background: Info' })
			await act(async () => {
				fireEvent.click(infoBgSwatch)
			})
			expect(editor.getJSON().content?.[0]?.attrs?.['bgTone']).toBe('info')
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('hides write controls in read-only mode while keeping Comment on text selection', async () => {
		const onComment = vi.fn()
		const { editor, unmount } = renderToolbar(false, onComment)
		try {
			await act(async () => {
				editor.commands.setTextSelection({ from: 1, to: 6 })
			})

			expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Turn into' })).not.toBeInTheDocument()
			const commentBtn = screen.getByRole('button', { name: 'Comment' })
			expect(commentBtn).toBeInTheDocument()
			fireEvent.click(commentBtn)
			expect(onComment).toHaveBeenCalledTimes(1)
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('edits the link URL in a popover anchored to the link button', async () => {
		const { editor, unmount } = renderToolbar()
		try {
			await act(async () => {
				editor.commands.setTextSelection({ from: 1, to: 6 })
			})
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Link URL' }))
			})

			const input = await screen.findByRole('textbox', { name: 'Link URL' })
			const toolbar = screen.getByRole('toolbar')
			expect(toolbar.contains(input)).toBe(false)

			await act(async () => {
				fireEvent.change(input, { target: { value: 'https://huriro.app' } })
				fireEvent.keyDown(input, { key: 'Enter' })
			})

			const text = editor.getJSON().content?.[0]?.content?.[0]
			expect(text?.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://huriro.app' } })
			expect(screen.queryByRole('textbox', { name: 'Link URL' })).not.toBeInTheDocument()
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

	it('prefills the popover with the existing href when selecting an existing link', async () => {
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
				editor.commands.setTextSelection({ from: 2, to: 5 })
			})
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Link URL' }))
			})
			const input = (await screen.findByRole('textbox', { name: 'Link URL' })) as HTMLInputElement
			await waitFor(() => {
				expect(input.value).toBe('https://existing.example')
			})
		} finally {
			unmount()
			editor.destroy()
		}
	})
})
