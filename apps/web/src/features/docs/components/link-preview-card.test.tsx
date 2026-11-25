import { createHuriroExtensions } from '@huriro/editor'
import { activateI18n } from '@huriro/i18n'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { LinkPreviewCard } from './link-preview-card'

activateI18n('en')

// "world" carries the link mark; positions inside it start after "hello ".
const LINKED_HTML = '<p>hello <a href="https://example.com/page">world</a></p>'

function renderWithCard(editable = true) {
	const editor = new Editor({
		editable,
		extensions: createHuriroExtensions({ collaborative: false }),
		content: LINKED_HTML
	})
	const rendered = render(
		<>
			<EditorContent editor={editor} />
			<LinkPreviewCard editor={editor} />
		</>
	)
	return { editor, ...rendered }
}

function anchorElement(): HTMLAnchorElement {
	const anchor = document.querySelector<HTMLAnchorElement>('.ProseMirror a')
	if (!anchor) throw new Error('link anchor not rendered')
	return anchor
}

// Clicking a link in a real browser also places the caret inside it; jsdom
// can't emulate caret placement, so tests move the selection explicitly.
async function clickLink(editor: Editor) {
	await act(async () => {
		editor.commands.setTextSelection(8)
	})
	await act(async () => {
		fireEvent.click(anchorElement())
	})
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('link preview card', () => {
	it('opens on link click with the href and all actions for writers', async () => {
		const { editor, unmount } = renderWithCard()
		try {
			await clickLink(editor)

			const card = screen.getByRole('dialog', { name: 'Link preview' })
			expect(card).toHaveTextContent('https://example.com/page')
			expect(screen.getByRole('button', { name: 'Open link in new tab' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Edit link' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Remove link' })).toBeInTheDocument()

			await expectNoViolations(card)
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('opens the href in a new tab with noopener', async () => {
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
		const { editor, unmount } = renderWithCard()
		try {
			await clickLink(editor)
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Open link in new tab' }))
			})
			expect(openSpy).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer')
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('removes the link mark but keeps the text', async () => {
		const { editor, unmount } = renderWithCard()
		try {
			await clickLink(editor)
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
			})

			// Text survives intact — with no marks left, adjacent text nodes merge.
			expect(editor.getText()).toContain('hello world')
			const nodes = editor.getJSON().content?.[0]?.content ?? []
			expect(nodes.some((node) => node.marks?.some((mark) => mark.type === 'link'))).toBe(false)
			// Card closes after the action.
			expect(screen.queryByRole('dialog', { name: 'Link preview' })).not.toBeInTheDocument()
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('edits the href inline and applies it to the whole link', async () => {
		const { editor, unmount } = renderWithCard()
		try {
			await clickLink(editor)
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Edit link' }))
			})

			const input = screen.getByRole('textbox', { name: 'Link URL' }) as HTMLInputElement
			expect(input.value).toBe('https://example.com/page')

			await act(async () => {
				fireEvent.change(input, { target: { value: 'https://changed.example' } })
				fireEvent.keyDown(input, { key: 'Enter' })
			})

			const nodes = editor.getJSON().content?.[0]?.content ?? []
			const world = nodes.find((node) => 'text' in node && node.text === 'world')
			expect(world?.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: 'https://changed.example' } })
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('hides edit and remove for read-only viewers but keeps open and copy', async () => {
		const { editor, unmount } = renderWithCard(false)
		try {
			await clickLink(editor)
			expect(screen.getByRole('button', { name: 'Open link in new tab' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Edit link' })).not.toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument()
		} finally {
			unmount()
			editor.destroy()
		}
	})

	it('closes when the pointer presses outside the card', async () => {
		const { editor, unmount } = renderWithCard()
		try {
			await clickLink(editor)
			expect(screen.getByRole('dialog', { name: 'Link preview' })).toBeInTheDocument()

			await act(async () => {
				fireEvent.pointerDown(document.body)
			})
			expect(screen.queryByRole('dialog', { name: 'Link preview' })).not.toBeInTheDocument()
		} finally {
			unmount()
			editor.destroy()
		}
	})
})
