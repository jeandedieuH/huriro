import { describe, expect, test } from 'bun:test'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import * as Y from 'yjs'
import {
	applyAllSuggestionsDecisionToYDoc,
	applySuggestionDecisionToYDoc,
	BlockStyleExtension,
	createHeadlessProseMirrorSchema,
	extractDocumentContent,
	extractSuggestionsFromYDoc,
	flattenOrphanedSuggestions,
	markdownToProseMirrorJson,
	normalizeColumnWidths,
	proposeSuggestionOnYDoc,
	proseMirrorJsonToMarkdown,
	proseMirrorJsonToSafeHtml,
	prosemirrorJsonToYDoc,
	renderStandaloneHtmlDocument,
	sanitizeHtml,
	ydocToMarkdown,
	ydocToProseMirrorJson
} from './index'

describe('@huriro/editor M9 authoring schema & blocks', () => {
	test('registers all M9 nodes and marks in headless ProseMirror schema', () => {
		const schema = createHeadlessProseMirrorSchema()
		for (const nodeName of [
			'columns',
			'column',
			'syncedBlock',
			'toggleHeading',
			'mermaidBlock',
			'mathInline',
			'mathBlock',
			'tocBlock',
			'bookmarkCard',
			'buttonBlock'
		]) {
			expect(schema.nodes[nodeName], `missing node ${nodeName}`).toBeDefined()
		}
		for (const markName of ['suggestionInsert', 'suggestionDelete']) {
			expect(schema.marks[markName], `missing mark ${markName}`).toBeDefined()
		}
		expect(schema.nodes['paragraph']?.spec.attrs?.['textTone']).toBeDefined()
		expect(schema.nodes['paragraph']?.spec.attrs?.['bgTone']).toBeDefined()
		expect(schema.nodes['tableCell']?.spec.attrs?.['backgroundTone']).toBeDefined()
		expect(schema.nodes['tableHeader']?.spec.attrs?.['backgroundTone']).toBeDefined()
	})

	test('normalizes column widths within bounds and sums to 100', () => {
		const two = normalizeColumnWidths(2)
		expect(two).toEqual([50, 50])
		const three = normalizeColumnWidths(3, [5, 10, 85])
		expect(three.every((w) => w >= 15)).toBe(true)
		expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1)
	})

	test('round-trips mermaid and math blocks cleanly through Markdown', () => {
		const md = [
			'# Math & Diagrams',
			'',
			'Inline formula $E = mc^2$ works inside text.',
			'',
			'$$',
			'\\sum_{i=1}^{n} x_i',
			'$$',
			'',
			'```mermaid',
			'flowchart TD',
			'  A --> B',
			'```'
		].join('\n')

		const json = markdownToProseMirrorJson(md, 'm9-md')
		expect(json.content.some((n) => n.type === 'mathBlock')).toBe(true)
		expect(json.content.some((n) => n.type === 'mermaidBlock')).toBe(true)
		const para = json.content.find((n) => n.type === 'paragraph')
		expect(para?.content?.some((n) => n.type === 'mathInline')).toBe(true)

		const exported = proseMirrorJsonToMarkdown(json)
		expect(exported).toContain('$E = mc^2$')
		expect(exported).toContain('```mermaid')
		expect(exported).toContain('$$')
	})

	test('extracts toggleHeading, backlinks, and syncedBlockIds from Y.Doc', () => {
		const ydoc = prosemirrorJsonToYDoc({
			type: 'doc',
			content: [
				{
					type: 'toggleHeading',
					attrs: { level: 2, summary: 'Runbook Section', open: true, blockId: 'th-1' },
					content: [
						{
							type: 'paragraph',
							attrs: { blockId: 'p-1' },
							content: [
								{ type: 'text', text: 'See ' },
								{
									type: 'text',
									text: 'API Spec',
									marks: [{ type: 'link', attrs: { href: '/docs/api-spec#block-1' } }]
								}
							]
						}
					]
				},
				{
					type: 'syncedBlock',
					attrs: {
						syncedBlockId: '0190a0b1-0000-7000-8000-000000000099',
						title: 'Disclaimer',
						fallbackText: 'Internal only'
					}
				}
			]
		})
		const extracted = extractDocumentContent(ydoc)
		expect(extracted.headings).toHaveLength(1)
		expect(extracted.headings[0]?.text).toBe('Runbook Section')
		expect(extracted.headings[0]?.level).toBe(2)
		expect(extracted.referencedLinks).toContainEqual({
			targetType: 'doc',
			targetRef: 'api-spec',
			by: 'slug'
		})
		expect(extracted.syncedBlockIds).toEqual(['0190a0b1-0000-7000-8000-000000000099'])
	})
	test('moves a block cleanly with BlockStyleExtension.moveBlock while preserving blockIds', () => {
		const schema = createHeadlessProseMirrorSchema()
		const doc = schema.nodeFromJSON({
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					attrs: { blockId: 'blk-1' },
					content: [{ type: 'text', text: 'First block' }]
				},
				{
					type: 'paragraph',
					attrs: { blockId: 'blk-2' },
					content: [{ type: 'text', text: 'Second block' }]
				},
				{
					type: 'paragraph',
					attrs: { blockId: 'blk-3' },
					content: [{ type: 'text', text: 'Third block' }]
				}
			]
		})
		let state = EditorState.create({ doc, schema })
		const commands = BlockStyleExtension.config.addCommands?.call({
			name: 'blockStyle',
			options: {},
			storage: {},
			editor: {} as never,
			type: null as never,
			parent: undefined
		})
		const moveBlock = commands?.moveBlock
		expect(moveBlock).toBeDefined()
		if (!moveBlock) return

		// Move first block (pos 0) after third block (end of doc)
		const firstPos = 0
		const docEnd = state.doc.content.size
		const movedDown = moveBlock(
			firstPos,
			docEnd
		)({
			state,
			dispatch: (tr: Transaction) => {
				state = state.apply(tr)
			}
		} as never)
		expect(movedDown).toBe(true)
		expect(state.doc.child(0).attrs['blockId']).toBe('blk-2')
		expect(state.doc.child(1).attrs['blockId']).toBe('blk-3')
		expect(state.doc.child(2).attrs['blockId']).toBe('blk-1')

		// Move third block back to top (pos 0)
		const thirdPos = state.doc.child(0).nodeSize + state.doc.child(1).nodeSize
		const movedUp = moveBlock(
			thirdPos,
			0
		)({
			state,
			dispatch: (tr: Transaction) => {
				state = state.apply(tr)
			}
		} as never)
		expect(movedUp).toBe(true)
		expect(state.doc.child(0).attrs['blockId']).toBe('blk-1')
		expect(state.doc.child(1).attrs['blockId']).toBe('blk-2')
		expect(state.doc.child(2).attrs['blockId']).toBe('blk-3')
	})
})

describe('@huriro/editor Suggestion Mode (ADR-0027)', () => {
	test('proposes, extracts, accepts, rejects, and recovers orphaned suggestions on Y.Doc', () => {
		const ydoc = prosemirrorJsonToYDoc({
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					attrs: { blockId: 'blk-1' },
					content: [{ type: 'text', text: 'The quick brown fox jumps.' }]
				}
			]
		})

		const r1 = proposeSuggestionOnYDoc(ydoc, {
			kind: 'replace',
			anchorBlockId: 'blk-1',
			targetText: 'brown',
			replacementText: 'red',
			authorType: 'user',
			authorId: '0190a0b1-0000-7000-8000-000000000001',
			groupId: 'grp-1'
		})
		expect(r1.applied).toBe(true)

		// Markdown export skips pending deletion marks.
		expect(ydocToMarkdown(ydoc)).toContain('The quick red fox jumps.')
		expect(ydocToMarkdown(ydoc)).not.toContain('brownred')

		const summaries = extractSuggestionsFromYDoc(ydoc)
		expect(summaries).toHaveLength(1)
		expect(summaries[0]).toMatchObject({
			groupId: 'grp-1',
			kind: 'replace',
			beforeText: 'brown',
			afterText: 'red',
			anchorBlockId: 'blk-1'
		})

		// Reject restores original text cleanly.
		expect(applySuggestionDecisionToYDoc(ydoc, 'grp-1', 'reject')).toBe(true)
		expect(extractSuggestionsFromYDoc(ydoc)).toHaveLength(0)
		expect(ydocToMarkdown(ydoc)).toBe('The quick brown fox jumps.')

		// Propose again and accept.
		proposeSuggestionOnYDoc(ydoc, {
			kind: 'replace',
			targetText: 'quick',
			replacementText: 'swift',
			authorType: 'agent',
			authorId: '0190a0b1-0000-7000-8000-000000000002',
			groupId: 'grp-2'
		})
		proposeSuggestionOnYDoc(ydoc, {
			kind: 'insert',
			replacementText: 'Always.',
			authorType: 'user',
			authorId: '0190a0b1-0000-7000-8000-000000000001',
			groupId: 'grp-3'
		})
		expect(extractSuggestionsFromYDoc(ydoc)).toHaveLength(2)
		expect(applyAllSuggestionsDecisionToYDoc(ydoc, 'accept')).toBe(true)
		expect(extractSuggestionsFromYDoc(ydoc)).toHaveLength(0)
		expect(ydocToMarkdown(ydoc)).toBe('The swift brown fox jumps. Always.')

		// Orphaned suggestion mark (missing groupId/authorId) flattens cleanly.
		const frag = ydoc.getXmlFragment('default')
		const para = frag.get(0) as Y.XmlElement
		const xmlText = para.get(0) as Y.XmlText
		xmlText.format(0, 3, { suggestionInsert: { suggestionId: '', groupId: '', authorId: '' } })
		expect(flattenOrphanedSuggestions(ydoc)).toBeGreaterThan(0)
	})

	test('10-editor randomized concurrent Yjs fuzz test converges on columns, synced blocks & suggestions (Gate G9)', () => {
		const initialDoc = prosemirrorJsonToYDoc({
			type: 'doc',
			content: [
				{
					type: 'columns',
					attrs: { widths: [50, 50], blockId: 'cols-1' },
					content: [
						{
							type: 'column',
							content: [
								{
									type: 'paragraph',
									attrs: { blockId: 'col-p-0' },
									content: [{ type: 'text', text: 'Left column baseline text.' }]
								}
							]
						},
						{
							type: 'column',
							content: [
								{
									type: 'paragraph',
									attrs: { blockId: 'col-p-1' },
									content: [{ type: 'text', text: 'Right column baseline text.' }]
								}
							]
						}
					]
				},
				{
					type: 'syncedBlock',
					attrs: {
						syncedBlockId: '0190a0b1-0000-7000-8000-000000000077',
						title: 'Shared Header',
						fallbackText: 'Shared Header',
						blockId: 'sync-1'
					}
				},
				{
					type: 'paragraph',
					attrs: { blockId: 'shared-p' },
					content: [{ type: 'text', text: 'Paragraph zero for concurrent suggestion fuzzing.' }]
				}
			]
		})
		const seedUpdate = Y.encodeStateAsUpdate(initialDoc)

		const peers = Array.from({ length: 10 }, (_, idx) => {
			const doc = new Y.Doc()
			Y.applyUpdate(doc, seedUpdate)
			return { idx, doc }
		})

		// Deterministic PRNG so CI is 100% reproducible while exercising scrambled concurrency.
		let seed = 0x51a7f911
		const rand = () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			return seed / 0x100000000
		}

		for (let round = 0; round < 20; round++) {
			for (const peer of peers) {
				const roll = rand()
				if (roll < 0.35) {
					proposeSuggestionOnYDoc(peer.doc, {
						kind: 'insert',
						anchorBlockId: peer.idx % 2 === 0 ? 'col-p-0' : 'shared-p',
						replacementText: `[p${peer.idx}r${round}]`,
						authorType: 'user',
						authorId: `0190a0b1-0000-7000-8000-00000000000${peer.idx}`,
						groupId: `fuzz-g-${peer.idx}-${round}`
					})
				} else if (roll < 0.6) {
					peer.doc.transact(() => {
						const frag = peer.doc.getXmlFragment('default')
						const cols = frag.get(0) as Y.XmlElement
						;(cols.setAttribute as unknown as (key: string, val: unknown) => void)(
							'widths',
							peer.idx % 2 === 0 ? [45, 55] : [55, 45]
						)
						const col = cols.get(peer.idx % 2) as Y.XmlElement
						const para = col.get(0) as Y.XmlElement
						const xmlText = para.get(0) as Y.XmlText
						xmlText.insert(0, `*`)
					}, `peer:${peer.idx}`)
				} else if (roll < 0.8) {
					const active = extractSuggestionsFromYDoc(peer.doc)
					const target = active.length > 0 ? active[Math.floor(rand() * active.length)] : undefined
					if (target) {
						applySuggestionDecisionToYDoc(peer.doc, target.groupId, rand() > 0.5 ? 'accept' : 'reject')
					}
				} else {
					peer.doc.transact(() => {
						const frag = peer.doc.getXmlFragment('default')
						const syncEl = frag.get(1) as Y.XmlElement
						syncEl.setAttribute('fallbackText', `Shared Header v${round}`)
					}, `peer:${peer.idx}`)
				}
			}

			// Exchange updates in randomized peer order.
			const order = [...peers].sort(() => rand() - 0.5)
			for (let i = 0; i < order.length; i++) {
				const from = order[i]
				const to = order[(i + 1) % order.length]
				if (from && to) {
					Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc))
				}
			}
		}

		// Final full gossip round to merge every update across all 10 peers.
		for (const src of peers) {
			const upd = Y.encodeStateAsUpdate(src.doc)
			for (const dst of peers) {
				if (src !== dst) Y.applyUpdate(dst.doc, upd)
			}
		}

		const firstPeer = peers[0]
		if (!firstPeer) throw new Error('expected at least one peer')
		const canonicalJson = ydocToProseMirrorJson(firstPeer.doc)
		const canonicalSuggestions = extractSuggestionsFromYDoc(firstPeer.doc)
		for (const peer of peers.slice(1)) {
			expect(ydocToProseMirrorJson(peer.doc)).toEqual(canonicalJson)
			expect(extractSuggestionsFromYDoc(peer.doc)).toEqual(canonicalSuggestions)
		}
	})
})

describe('@huriro/editor HTML export & XSS fuzz corpus (Gate G9)', () => {
	const XSS_CORPUS = [
		'<script>alert(1)</script>',
		'<scr<script>ipt>alert(1)</scr</script>ipt>',
		'<img src=x onerror=alert(1)>',
		'<img src="java&#x09;script:alert(1)">',
		'<svg><script>alert(1)</script></svg>',
		'<svg onload=alert(1)>',
		'<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
		'<iframe srcdoc="<script>alert(1)</script>"></iframe>',
		'<object data="data:text/html,<script>alert(1)</script>"></object>',
		'<embed src="javascript:alert(1)">',
		'<a href="javascript:alert(1)">bad</a>',
		'<a href="JaVaScRiPt:alert(1)">bad</a>',
		'<a href="&#0000106avascript:alert(1)">bad</a>',
		'<a href="vbscript:msgbox(1)">bad</a>',
		'<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">bad</a>',
		'<p style="width:expression(alert(1))">css</p>',
		'<ins data-suggestion-insert="true" onclick="alert(1)">ok</ins>',
		'<del data-suggestion-delete="true" onmouseover="alert(1)">old</del>',
		'<details open ontoggle="alert(1)"><summary>s</summary><script>x</script></details>',
		'<noscript><img src="x" onerror="alert(1)"></noscript>',
		'<template><script>alert(1)</script></template>',
		'<style>@import "https://evil.test/x.css";</style>'
	]

	test.each(XSS_CORPUS)('sanitizes XSS payload %s in HTML and standalone output', (payload) => {
		const cleaned = sanitizeHtml(payload)
		expect(cleaned).not.toMatch(/<script/i)
		expect(cleaned).not.toMatch(/<svg/i)
		expect(cleaned).not.toMatch(/<math/i)
		expect(cleaned).not.toMatch(/<iframe/i)
		expect(cleaned).not.toMatch(/<object/i)
		expect(cleaned).not.toMatch(/<embed/i)
		expect(cleaned).not.toMatch(/<style/i)
		expect(cleaned).not.toMatch(/on[a-z]+\s*=/i)
		expect(cleaned).not.toMatch(/javascript:/i)
		expect(cleaned).not.toMatch(/vbscript:/i)
		expect(cleaned).not.toMatch(/data:text\/html/i)
		expect(cleaned).not.toMatch(/expression\(/i)

		const standalone = renderStandaloneHtmlDocument({
			title: 'Public Doc',
			html: payload,
			allowSearchIndexing: false
		})
		expect(standalone).toContain('noindex, nofollow')
		expect(standalone).not.toContain('<script>')
		expect(standalone).not.toMatch(/onerror|onload|onclick|ontoggle|onmouseover/i)
		const withUnsafeTitle = renderStandaloneHtmlDocument({
			title: '<script>alert(1)</script>',
			html: '<p>Safe</p>'
		})
		expect(withUnsafeTitle).not.toContain('<script>')
		expect(withUnsafeTitle).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
	})

	test('serializes ProseMirror doc with M9 blocks into sanitized HTML', () => {
		const html = proseMirrorJsonToSafeHtml({
			type: 'doc',
			content: [
				{
					type: 'heading',
					attrs: { level: 1, blockId: 'h1-1' },
					content: [{ type: 'text', text: 'Title' }]
				},
				{
					type: 'bookmarkCard',
					attrs: { url: 'javascript:alert(1)', title: 'Evil' }
				},
				{
					type: 'bookmarkCard',
					attrs: { url: 'https://huriro.app', title: 'Huriro' }
				}
			]
		})
		expect(html).toContain('id="block-h1-1"')
		expect(html).toContain('https://huriro.app')
		expect(html).not.toContain('javascript:')
	})
})
