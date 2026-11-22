/**
 * Markdown directory/zip importer normalizer (§17.13b): preserves folder nesting,
 * strips frontmatter metadata cleanly, and infers titles from headings or filenames.
 */
import type { MarkdownImportPayload } from '@huriro/contracts'
import type { NormalizedDocImportPage } from './notion'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseFrontmatterTitle(md: string): { readonly title: string | null; readonly body: string } {
	const m = FRONTMATTER_RE.exec(md)
	if (!m) return { title: null, body: md }
	const yaml = m[1] ?? ''
	const titleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(yaml)
	return {
		title: titleMatch?.[1]?.trim() ?? null,
		body: md.slice(m[0].length)
	}
}

function titleFromPath(path: string): string {
	const name = (path.split('/').at(-1) ?? path).replace(/\.(md|markdown|txt)$/i, '')
	const pretty = name.replace(/[-_]+/g, ' ').trim()
	return pretty.length > 0 ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : 'Untitled'
}

export function normalizeMarkdownPayload(payload: MarkdownImportPayload): {
	readonly rootTitle: string | null
	readonly pages: NormalizedDocImportPage[]
} {
	const folderMap = new Map<string, NormalizedDocImportPage>()
	const pages: NormalizedDocImportPage[] = []

	for (const file of payload.files) {
		const normPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
		const parts = normPath.split('/').filter(Boolean)
		const { title: fmTitle, body } = parseFrontmatterTitle(file.markdown)
		const h1Match = /^\s*#\s+(.+)$/m.exec(body)
		const title = (file.title?.trim() || fmTitle || h1Match?.[1]?.trim() || titleFromPath(normPath)).slice(
			0,
			200
		)

		// Synthesize intermediate folder pages so deep directory trees preserve hierarchy.
		let parentRemotePath: string | null = null
		for (let i = 0; i < parts.length - 1; i++) {
			const folderPath = parts.slice(0, i + 1).join('/')
			if (!folderMap.has(folderPath)) {
				const folderName = parts[i] ?? 'Folder'
				folderMap.set(folderPath, {
					remoteId: `dir:${folderPath}`,
					remotePath: folderPath,
					remoteIdentifier: `dir:${folderPath}`,
					title: titleFromPath(folderName).slice(0, 200),
					markdown: '',
					parentRemotePath,
					depthHint: i + 1
				})
			}
			parentRemotePath = folderPath
		}

		pages.push({
			remoteId: `md:${normPath}`,
			remotePath: normPath,
			remoteIdentifier: normPath,
			title,
			markdown: body,
			parentRemotePath,
			depthHint: parts.length
		})
	}

	const combined = [...folderMap.values(), ...pages].sort(
		(a, b) => a.depthHint - b.depthHint || a.remotePath.localeCompare(b.remotePath)
	)
	return {
		rootTitle: payload.rootTitle ?? null,
		pages: combined
	}
}
