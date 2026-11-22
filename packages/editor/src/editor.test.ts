import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'
import {
	appendProseMirrorNodesToYDoc,
	createHeadlessProseMirrorSchema,
	diffVersionText,
	encodeTextAnchor,
	extractDocumentContent,
	extractPersonHandleMentions,
	isSafeUrl,
	markdownToProseMirrorJson,
	markdownToYDocUpdate,
	proseMirrorJsonToMarkdown,
	prosemirrorJsonToYDoc,
	replaceYDocContent,
	resolveTextAnchor,
	sanitizeHtml,
	ydocToMarkdown,
	ydocToProseMirrorJson
} from './index'

describe('@huriro/editor schema & headless Yjs', () => {
	test('builds headless ProseMirror schema without DOM', () => {
		const schema = createHeadlessProseMirrorSchema()
		expect(schema.nodes['callout']).toBeDefined()
		expect(schema.nodes['toggle']).toBeDefined()
		expect(schema.nodes['entityMention']).toBeDefined()
		expect(schema.nodes['referenceBlock']).toBeDefined()
		expect(schema.nodes['embed']).toBeDefined()
		expect(schema.marks['commentAnchor']).toBeDefined()
	})

	test('extracts plainText, headings, blocks, and entity mentions from Y.Doc', () => {
		const md = [
			'# Architecture Overview',
			'',
			'Reviewed with @[Alice](person:0190a0b1-0000-7000-8000-000000000010) on #[ENG-1](issue:0190a0b1-0000-7000-8000-000000000020).',
			'',
			'## Sync Invariants',
			'',
			'> [!WARNING] Never skip cursor allocation'
		].join('\n')

		const update = markdownToYDocUpdate(md, 'doc-1')
		const ydoc = new Y.Doc()
		Y.applyUpdate(ydoc, update)

		const extracted = extractDocumentContent(ydoc)
		expect(extracted.headings).toHaveLength(2)
		expect(extracted.headings[0]?.text).toBe('Architecture Overview')
		expect(extracted.headings[0]?.level).toBe(1)
		expect(extracted.headings[1]?.text).toBe('Sync Invariants')
		expect(extracted.headings[1]?.level).toBe(2)
		expect(extracted.mentions).toEqual([
			{ entityType: 'person', entityId: '0190a0b1-0000-7000-8000-000000000010', label: 'Alice' },
			{ entityType: 'issue', entityId: '0190a0b1-0000-7000-8000-000000000020', label: 'ENG-1' }
		])
		expect(extracted.blocks.length).toBeGreaterThanOrEqual(4)
		expect(extracted.plainText).toContain('Architecture Overview')
		expect(extracted.plainText).toContain('Never skip cursor allocation')
	})

	test('replaceYDocContent converges across two synced Y.Docs for non-destructive restore', () => {
		const docA = prosemirrorJsonToYDoc(markdownToProseMirrorJson('# V1\n\nInitial text', 'v1'))
		const docB = new Y.Doc()
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))

		// Forward edits on docB
		appendProseMirrorNodesToYDoc(docB, [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Extra line' }] }
		])
		Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB))
		expect(ydocToMarkdown(docA)).toContain('Extra line')

		// Restore V1 on docA and replicate to docB
		const v1Json = markdownToProseMirrorJson('# V1\n\nInitial text', 'v1')
		replaceYDocContent(docA, v1Json, 'huriro:restore')
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))

		expect(ydocToProseMirrorJson(docB)).toEqual(ydocToProseMirrorJson(docA))
		expect(ydocToMarkdown(docB)).not.toContain('Extra line')
		expect(ydocToMarkdown(docB)).toContain('Initial text')
	})
})

describe('@huriro/editor RelativePosition comment anchors', () => {
	test('survives concurrent edits before and after anchored text', () => {
		const ydoc = prosemirrorJsonToYDoc(markdownToProseMirrorJson('Alpha target phrase omega', 'anc'))
		const start = 'Alpha '.length
		const end = start + 'target phrase'.length
		const anchor = encodeTextAnchor(ydoc, start, end)
		expect(anchor).not.toBeNull()
		if (!anchor) return
		expect(anchor.anchorQuote).toBe('target phrase')

		// Concurrent insertion BEFORE the anchored text inside the same XmlText
		const frag = ydoc.getXmlFragment('default')
		const firstPara = frag.get(0) as Y.XmlElement
		const xmlText = firstPara.get(0) as Y.XmlText
		xmlText.insert(0, 'PREFIX ')

		const resolved = resolveTextAnchor(ydoc, anchor.anchorFrom, anchor.anchorTo)
		expect(resolved.status).toBe('attached')
		if (resolved.status === 'attached') {
			expect(resolved.text).toBe('target phrase')
			expect(resolved.from).toBe(start + 'PREFIX '.length)
		}
	})

	test('surfaces orphaned status when anchored text is deleted', () => {
		const ydoc = prosemirrorJsonToYDoc(markdownToProseMirrorJson('Keep delete-me keep', 'orphan'))
		const start = 'Keep '.length
		const end = start + 'delete-me'.length
		const anchor = encodeTextAnchor(ydoc, start, end)
		expect(anchor).not.toBeNull()
		if (!anchor) return

		const frag = ydoc.getXmlFragment('default')
		const firstPara = frag.get(0) as Y.XmlElement
		const xmlText = firstPara.get(0) as Y.XmlText
		xmlText.delete(start, 'delete-me'.length)

		const resolved = resolveTextAnchor(ydoc, anchor.anchorFrom, anchor.anchorTo)
		expect(resolved.status).toBe('orphaned')
	})
})

describe('@huriro/editor Markdown round-trip & version diff', () => {
	test('round-trips headings, lists, tasks, code blocks, callouts, tables, and safe links', () => {
		const md = [
			'# Spec Title',
			'',
			'Paragraph with **bold**, *italic*, ~~strike~~, `inline`, and [docs](https://huriro.app/docs).',
			'',
			'- item one',
			'- item two',
			'',
			'1. step one',
			'2. step two',
			'',
			'- [x] done task',
			'- [ ] open task',
			'',
			'```ts',
			'const x = 1',
			'```',
			'',
			'| Key | Val |',
			'| --- | --- |',
			'| a | b |'
		].join('\n')

		const json = markdownToProseMirrorJson(md, 'rt')
		const back = proseMirrorJsonToMarkdown(json)
		const json2 = markdownToProseMirrorJson(back, 'rt')
		expect(proseMirrorJsonToMarkdown(json2)).toBe(back)
	})

	test('computes line-level LCS version diff hunks', () => {
		const diff = diffVersionText('line 1\nline 2\nline 3', 'line 1\nline 2b\nline 3\nline 4')
		expect(diff).toEqual([
			{ kind: 'equal', text: 'line 1' },
			{ kind: 'remove', text: 'line 2' },
			{ kind: 'add', text: 'line 2b' },
			{ kind: 'equal', text: 'line 3' },
			{ kind: 'add', text: 'line 4' }
		])
	})

	test('extracts @handle mentions cleanly', () => {
		expect(extractPersonHandleMentions('Hey @alice and @bob.smith!')).toEqual(['alice', 'bob.smith'])
	})
})

describe('@huriro/editor XSS & URL sanitization fuzz corpus (§12.6)', () => {
	const XSS_URLS = [
		'javascript:alert(1)',
		'JAVASCRIPT:alert(1)',
		'java\nscript:alert(1)',
		'&#106;avascript:alert(1)',
		'&#x6a;avascript:alert(1)',
		'vbscript:msgbox(1)',
		'data:text/html,<script>alert(1)</script>',
		'//evil.example.com/phish'
	]

	test.each(XSS_URLS)('rejects unsafe URL %s', (url) => {
		expect(isSafeUrl(url)).toBe(false)
	})

	const SAFE_URLS = [
		'https://huriro.app/docs',
		'http://localhost:3000/docs',
		'/docs/rfc',
		'#block-1',
		'mailto:hi@huriro.app'
	]
	test.each(SAFE_URLS)('accepts safe URL %s', (url) => {
		expect(isSafeUrl(url)).toBe(true)
	})

	const XSS_HTML_CORPUS = [
		'<script>alert(1)</script><p>ok</p>',
		'<img src="x" onerror="alert(1)">',
		'<a href="javascript:alert(1)">click</a>',
		'<a href="&#106;avascript:alert(1)" onclick="steal()">click</a>',
		'<iframe src="https://evil.test"></iframe>',
		'<svg onload="alert(1)"><circle/></svg>',
		'<math><mtext><script>alert(1)</script></mtext></math>',
		'<object data="data:text/html,<script>1</script>"></object>',
		'<embed src="evil.swf">',
		'<div style="background:url(javascript:alert(1))" onmouseover="alert(1)">hi</div>',
		'<form action="https://evil.test"><input type="text"></form>',
		'<details open ontoggle="alert(1)"><summary>s</summary></details>',
		'<p data-block-id="b1" srcdoc="<script>1</script>">safe</p>'
	]

	test.each(XSS_HTML_CORPUS)('sanitizes HTML payload: %s', (payload) => {
		const out = sanitizeHtml(payload)
		expect(out).not.toMatch(/<script/i)
		expect(out).not.toMatch(/<iframe/i)
		expect(out).not.toMatch(/<svg/i)
		expect(out).not.toMatch(/<object/i)
		expect(out).not.toMatch(/<embed/i)
		expect(out).not.toMatch(/<form/i)
		expect(out).not.toMatch(/onerror\s*=/i)
		expect(out).not.toMatch(/onload\s*=/i)
		expect(out).not.toMatch(/onclick\s*=/i)
		expect(out).not.toMatch(/onmouseover\s*=/i)
		expect(out).not.toMatch(/ontoggle\s*=/i)
		expect(out).not.toMatch(/javascript:/i)
		expect(out).not.toMatch(/srcdoc\s*=/i)
		expect(out).not.toMatch(/style\s*=/i)
	})

	test('strips raw HTML from imported Markdown', () => {
		const md = '# Safe\n\n<script>alert(1)</script>\n\n[xss](javascript:alert(1))'
		const json = markdownToProseMirrorJson(md)
		const out = proseMirrorJsonToMarkdown(json)
		expect(out).not.toContain('<script')
		expect(out).not.toContain('javascript:')
	})
})
