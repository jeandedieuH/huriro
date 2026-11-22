import { type Extensions, getSchema } from '@tiptap/core'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import type { Schema } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import type * as Y from 'yjs'
import {
	BlockIdExtension,
	CalloutExtension,
	CommentAnchorMark,
	EmbedExtension,
	EntityMentionExtension,
	ReferenceBlockExtension,
	ToggleExtension
} from './extensions'
import { isSafeUrl } from './sanitize'

export const DOCUMENT_SIZE_WARN_BYTES = 2 * 1024 * 1024 // 2 MB (§10.2)
export const DOCUMENT_SIZE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB (§10.2)

const lowlight = createLowlight(common)

export interface HuriroExtensionsOptions {
	readonly collaborative?: boolean | undefined
	readonly ydoc?: Y.Doc | undefined
	readonly field?: string | undefined
	readonly provider?: unknown | undefined
	readonly user?: { readonly name: string; readonly color: string; readonly userId?: string } | undefined
	readonly placeholder?: string | undefined
}

export function createHuriroExtensions(options: HuriroExtensionsOptions = {}): Extensions {
	const collaborative = options.collaborative ?? Boolean(options.ydoc)

	const extensions: Extensions = [
		StarterKit.configure({
			undoRedo: collaborative ? false : {},
			codeBlock: false,
			link: {
				openOnClick: false,
				autolink: true,
				isAllowedUri: (url) => isSafeUrl(url)
			}
		}),
		CodeBlockLowlight.configure({
			lowlight
		}),
		Table.configure({
			resizable: false
		}),
		TableRow,
		TableHeader,
		TableCell,
		TaskList,
		TaskItem.configure({
			nested: true
		}),
		Image.configure({
			allowBase64: false
		}),
		Placeholder.configure({
			placeholder: options.placeholder ?? 'Write or type / for blocks…'
		}),
		BlockIdExtension,
		CalloutExtension,
		ToggleExtension,
		EntityMentionExtension,
		EmbedExtension,
		ReferenceBlockExtension,
		CommentAnchorMark
	]

	if (options.ydoc) {
		extensions.push(
			Collaboration.configure({
				document: options.ydoc,
				field: options.field ?? 'default'
			})
		)
	}

	if (options.provider && options.user) {
		extensions.push(
			CollaborationCaret.configure({
				provider: options.provider,
				user: options.user
			})
		)
	}

	return extensions
}

let cachedSchema: Schema | null = null

export function createHeadlessProseMirrorSchema(): Schema {
	if (!cachedSchema) {
		cachedSchema = getSchema(createHuriroExtensions({ collaborative: false }))
	}
	return cachedSchema
}
