'use dom'

import {
	createHuriroExtensions,
	markdownToProseMirrorJson,
	proseMirrorJsonToMarkdown,
	sanitizeHtml
} from '@huriro/editor'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'

export interface DocDomEditorProps {
	readonly dom?: { readonly matchContents?: boolean } | undefined
	readonly initialMarkdown: string
	readonly docId: string
	readonly readOnly?: boolean | undefined
	readonly onSaveMarkdown?: (markdown: string) => void | Promise<void>
}

/**
 * Light mobile rich-text editor using Expo DOM component (`'use dom'`) +
 * shared `@huriro/editor` schema & sanitizer (§6.3, §18.2).
 */
export function DocDomEditor({
	initialMarkdown,
	docId,
	readOnly = false,
	onSaveMarkdown
}: DocDomEditorProps) {
	const editor = useEditor({
		extensions: createHuriroExtensions({
			collaborative: false
		}),
		content: markdownToProseMirrorJson(initialMarkdown, docId) as Record<string, unknown>,
		editable: !readOnly
	})

	useEffect(() => {
		if (!editor) return
		editor.setEditable(!readOnly)
	}, [editor, readOnly])

	function handleSave() {
		if (!editor || !onSaveMarkdown) return
		const cleanHtml = sanitizeHtml(editor.getHTML())
		const md = proseMirrorJsonToMarkdown(editor.getJSON() as never)
		void cleanHtml
		void onSaveMarkdown(md)
	}

	return (
		<div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: 14, color: '#18181b' }}>
			{!readOnly && onSaveMarkdown ? (
				<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
					<button
						type="button"
						onClick={handleSave}
						style={{
							padding: '8px 14px',
							borderRadius: 10,
							border: 'none',
							background: '#e11d48',
							color: '#ffffff',
							fontSize: 13,
							fontWeight: 600
						}}
					>
						Save Document
					</button>
				</div>
			) : null}
			<EditorContent editor={editor} />
		</div>
	)
}
