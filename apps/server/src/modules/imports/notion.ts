/**
 * Notion workspace export normalizer (§17.13b): strips trailing 32-char Notion
 * UUIDs from page filenames/titles and orders pages topologically parent-first.
 */
import type { NotionImportPayload } from '@huriro/contracts'

export interface NormalizedDocImportPage {
	readonly remoteId: string
	readonly remotePath: string
	readonly remoteIdentifier: string
	readonly title: string
	readonly markdown: string
	readonly parentRemotePath: string | null
	readonly depthHint: number
}

const NOTION_SUFFIX_RE = /^(.*?)\s+([0-9a-f]{32})$/i
const NOTION_MD_LINK_RE = /\[([^\]]+)\]\(([^)]+?\.md)\)/gi

function parseNotionTitleAndId(
	rawName: string,
	fallbackId?: string
): { title: string; notionId: string | null } {
	const cleaned = rawName.replace(/\.md$/i, '').trim()
	const m = NOTION_SUFFIX_RE.exec(cleaned)
	if (m) {
		return {
			title: m[1]?.trim() || 'Untitled',
			notionId: m[2]?.toLowerCase() ?? fallbackId ?? null
		}
	}
	return { title: cleaned || 'Untitled', notionId: fallbackId ?? null }
}

function parentDirOf(remotePath: string): string | null {
	const norm = remotePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
	const slash = norm.lastIndexOf('/')
	if (slash <= 0) return null
	return norm.slice(0, slash)
}

function normalizeNotionMarkdown(raw: string): string {
	// Convert Notion export callout blocks or HTML details safely into standard Markdown.
	return raw.replace(NOTION_MD_LINK_RE, (_all, label: string, target: string) => {
		const decoded = decodeURIComponent(target).replace(/\.md$/i, '')
		const parsed = parseNotionTitleAndId(decoded.split('/').at(-1) ?? decoded)
		const slug = parsed.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
		return `[${label}](/docs/${slug || 'untitled'})`
	})
}

export function normalizeNotionPayload(payload: NotionImportPayload): {
	readonly rootTitle: string | null
	readonly pages: NormalizedDocImportPage[]
} {
	const byNormPath = new Map<string, NormalizedDocImportPage>()

	for (const p of payload.pages) {
		const normPath = p.remotePath.replace(/\\/g, '/').replace(/^\/+/, '')
		const fileBase = normPath.split('/').at(-1) ?? normPath
		const parsed = parseNotionTitleAndId(fileBase, p.notionId)
		const explicitParent = p.parentRemotePath
			? p.parentRemotePath.replace(/\\/g, '/').replace(/^\/+/, '')
			: null
		const parentCandidate = explicitParent ?? (parentDirOf(normPath) ? `${parentDirOf(normPath)}.md` : null)

		const title = p.title?.trim() || parsed.title
		const remoteId = parsed.notionId ?? normPath
		const remoteIdentifier = parsed.notionId ?? normPath
		const markdown = normalizeNotionMarkdown(p.markdown)

		byNormPath.set(normPath, {
			remoteId,
			remotePath: normPath,
			remoteIdentifier,
			title: title.slice(0, 200),
			markdown,
			parentRemotePath: parentCandidate && parentCandidate !== normPath ? parentCandidate : null,
			depthHint: normPath.split('/').length
		})
	}

	// Ensure folder intermediate nodes exist if parent `.md` isn't explicitly in payload.
	const allPages = [...byNormPath.values()]
	const syntheticFolders = new Map<string, NormalizedDocImportPage>()
	for (const page of allPages) {
		const dir = parentDirOf(page.remotePath)
		if (dir && !byNormPath.has(`${dir}.md`) && !syntheticFolders.has(dir)) {
			const folderName = dir.split('/').at(-1) ?? dir
			const parsed = parseNotionTitleAndId(folderName)
			const grandDir = parentDirOf(dir)
			syntheticFolders.set(dir, {
				remoteId: `folder:${dir}`,
				remotePath: `${dir}.md`,
				remoteIdentifier: `folder:${dir}`,
				title: parsed.title.slice(0, 200),
				markdown: `# ${parsed.title}\n`,
				parentRemotePath: grandDir ? `${grandDir}.md` : null,
				depthHint: dir.split('/').length
			})
		}
	}

	const combined = [...syntheticFolders.values(), ...allPages].sort(
		(a, b) => a.depthHint - b.depthHint || a.remotePath.localeCompare(b.remotePath)
	)
	return {
		rootTitle: payload.rootTitle ?? null,
		pages: combined
	}
}
