/**
 * Lazy-loaded MIT pure-TypeScript Mermaid parser & SVG renderer (§4.2, Gate G9).
 * Zero third-party copyleft dependencies; loaded via dynamic `import('./mermaid-renderer')`
 * so diagram rendering stays completely out of the initial web shell bundle.
 */

export type MermaidRenderResult =
	| { readonly ok: true; readonly svg: string }
	| { readonly ok: false; readonly error: string }

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

type NodeShape = 'rect' | 'round' | 'diamond'

interface GraphNode {
	readonly id: string
	label: string
	shape: NodeShape
}

interface GraphEdge {
	readonly from: string
	readonly to: string
	readonly label: string
	readonly dashed: boolean
}

function parseNodeToken(raw: string): {
	readonly id: string
	readonly label?: string
	readonly shape?: NodeShape
} {
	const trimmed = raw.trim()
	const diamond = /^([A-Za-z0-9_.-]+)\{([\s\S]+)\}$/.exec(trimmed)
	if (diamond?.[1] && diamond[2] !== undefined) {
		return { id: diamond[1], label: diamond[2].replace(/^"|"$/g, ''), shape: 'diamond' }
	}
	const round = /^([A-Za-z0-9_.-]+)\(\(?([\s\S]+?)\)?\)$/.exec(trimmed)
	if (round?.[1] && round[2] !== undefined) {
		return { id: round[1], label: round[2].replace(/^"|"$/g, ''), shape: 'round' }
	}
	const rect = /^([A-Za-z0-9_.-]+)\[\[?([\s\S]+?)\]?\]$/.exec(trimmed)
	if (rect?.[1] && rect[2] !== undefined) {
		return { id: rect[1], label: rect[2].replace(/^"|"$/g, ''), shape: 'rect' }
	}
	const idMatch = /^([A-Za-z0-9_.-]+)/.exec(trimmed)
	return { id: idMatch?.[1] ?? trimmed }
}

function upsertNode(nodes: Map<string, GraphNode>, token: ReturnType<typeof parseNodeToken>): void {
	const existing = nodes.get(token.id)
	if (!existing) {
		nodes.set(token.id, {
			id: token.id,
			label: token.label ?? token.id,
			shape: token.shape ?? 'rect'
		})
	} else if (token.label) {
		existing.label = token.label
		if (token.shape) existing.shape = token.shape
	}
}

function renderFlowchartSvg(header: string, lines: readonly string[]): MermaidRenderResult {
	const dirMatch = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)/i.exec(header)
	const dir = (dirMatch?.[1] ?? 'TD').toUpperCase()
	const horizontal = dir === 'LR' || dir === 'RL'

	const nodes = new Map<string, GraphNode>()
	const edges: GraphEdge[] = []

	for (const line of lines) {
		if (!line || line.startsWith('%%') || line.startsWith('subgraph ') || line === 'end') continue
		const arrowRe = /^(.+?)\s*(-->|--\|([^|]+)\||-\.->|---)\s*(?:\|([^|]+)\|\s*)?(.+)$/
		const m = arrowRe.exec(line)
		if (m?.[1] && m[2] && m[5]) {
			const fromTok = parseNodeToken(m[1])
			const toTok = parseNodeToken(m[5])
			upsertNode(nodes, fromTok)
			upsertNode(nodes, toTok)
			edges.push({
				from: fromTok.id,
				to: toTok.id,
				label: (m[3] ?? m[4] ?? '').trim(),
				dashed: m[2].includes('.')
			})
			continue
		}
		const solo = parseNodeToken(line)
		if (solo.id && solo.label) {
			upsertNode(nodes, solo)
		}
	}

	if (nodes.size === 0) {
		return { ok: false, error: 'No flowchart nodes found. Example: flowchart LR\nA[Start] --> B[End]' }
	}

	// Compute topological layers via Kahn's BFS so nodes lay out cleanly without overlaps.
	const inDeg = new Map<string, number>()
	const adj = new Map<string, string[]>()
	for (const id of nodes.keys()) {
		inDeg.set(id, 0)
		adj.set(id, [])
	}
	for (const e of edges) {
		inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
		adj.get(e.from)?.push(e.to)
	}
	const layerOf = new Map<string, number>()
	const queue: string[] = []
	for (const [id, deg] of inDeg.entries()) {
		if (deg === 0) {
			layerOf.set(id, 0)
			queue.push(id)
		}
	}
	let qIdx = 0
	while (qIdx < queue.length) {
		const cur = queue[qIdx]
		qIdx += 1
		if (!cur) continue
		const curLayer = layerOf.get(cur) ?? 0
		for (const nxt of adj.get(cur) ?? []) {
			layerOf.set(nxt, Math.max(layerOf.get(nxt) ?? 0, curLayer + 1))
			const nextDeg = (inDeg.get(nxt) ?? 1) - 1
			inDeg.set(nxt, nextDeg)
			if (nextDeg <= 0) queue.push(nxt)
		}
	}
	for (const id of nodes.keys()) {
		if (!layerOf.has(id)) layerOf.set(id, 0)
	}

	const byLayer = new Map<number, GraphNode[]>()
	let maxLayer = 0
	for (const node of nodes.values()) {
		const layer = layerOf.get(node.id) ?? 0
		maxLayer = Math.max(maxLayer, layer)
		const arr = byLayer.get(layer) ?? []
		arr.push(node)
		byLayer.set(layer, arr)
	}

	const nodeW = 148
	const nodeH = 44
	const gapPrimary = 58
	const gapCross = 28
	const pad = 24

	let maxCrossCount = 1
	for (const arr of byLayer.values()) {
		maxCrossCount = Math.max(maxCrossCount, arr.length)
	}

	const pos = new Map<string, { x: number; y: number }>()
	for (let l = 0; l <= maxLayer; l++) {
		const layerNodes = byLayer.get(l) ?? []
		const effectiveLayer = dir === 'RL' || dir === 'BT' ? maxLayer - l : l
		for (let i = 0; i < layerNodes.length; i++) {
			const node = layerNodes[i]
			if (!node) continue
			if (horizontal) {
				pos.set(node.id, {
					x: pad + effectiveLayer * (nodeW + gapPrimary),
					y: pad + i * (nodeH + gapCross)
				})
			} else {
				pos.set(node.id, {
					x: pad + i * (nodeW + gapCross),
					y: pad + effectiveLayer * (nodeH + gapPrimary)
				})
			}
		}
	}

	const svgW = horizontal
		? pad * 2 + (maxLayer + 1) * nodeW + maxLayer * gapPrimary
		: pad * 2 + maxCrossCount * nodeW + Math.max(0, maxCrossCount - 1) * gapCross
	const svgH = horizontal
		? pad * 2 + maxCrossCount * nodeH + Math.max(0, maxCrossCount - 1) * gapCross
		: pad * 2 + (maxLayer + 1) * nodeH + maxLayer * gapPrimary

	const defs = `<defs><marker id="huriro-mermaid-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 8 5 L 0 9 z" fill="var(--primary)"/></marker></defs>`

	const edgeSvg = edges
		.map((e) => {
			const a = pos.get(e.from)
			const b = pos.get(e.to)
			if (!a || !b) return ''
			const x1 = horizontal ? a.x + nodeW : a.x + nodeW / 2
			const y1 = horizontal ? a.y + nodeH / 2 : a.y + nodeH
			const x2 = horizontal ? b.x : b.x + nodeW / 2
			const y2 = horizontal ? b.y + nodeH / 2 : b.y
			const cx = (x1 + x2) / 2
			const cy = (y1 + y2) / 2
			const dashAttr = e.dashed ? ' stroke-dasharray="5 4"' : ''
			const path = horizontal
				? `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`
				: `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`
			const labelPart = e.label
				? `<rect x="${cx - 34}" y="${cy - 10}" width="68" height="20" rx="4" fill="var(--card)" stroke="var(--border)" stroke-width="1"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">${escapeXml(e.label)}</text>`
				: ''
			return `<path d="${path}" fill="none" stroke="var(--primary)" stroke-width="1.5"${dashAttr} marker-end="url(#huriro-mermaid-arrow)"/>${labelPart}`
		})
		.join('')

	const nodeSvg = [...nodes.values()]
		.map((n) => {
			const p = pos.get(n.id)
			if (!p) return ''
			const cx = p.x + nodeW / 2
			const cy = p.y + nodeH / 2
			let shapeEl: string
			if (n.shape === 'diamond') {
				shapeEl = `<polygon points="${cx},${p.y - 4} ${p.x + nodeW + 4},${cy} ${cx},${p.y + nodeH + 4} ${p.x - 4},${cy}" fill="var(--card)" stroke="var(--primary)" stroke-width="1.5"/>`
			} else {
				const rx = n.shape === 'round' ? '22' : '8'
				shapeEl = `<rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="${rx}" fill="var(--card)" stroke="var(--border)" stroke-width="1.5"/>`
			}
			return `<g>${shapeEl}<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" font-weight="500" fill="var(--foreground)">${escapeXml(n.label.slice(0, 22))}</text></g>`
		})
		.join('')

	return {
		ok: true,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" style="max-width:${svgW}px;height:auto;font-family:var(--font-sans)">${defs}${edgeSvg}${nodeSvg}</svg>`
	}
}

function renderSequenceSvg(lines: readonly string[]): MermaidRenderResult {
	const participants: string[] = []
	const aliases = new Map<string, string>()
	const messages: Array<{ from: string; to: string; text: string; dashed: boolean }> = []

	const ensureParticipant = (id: string) => {
		if (!participants.includes(id)) participants.push(id)
	}

	for (const line of lines) {
		if (!line || line.startsWith('%%')) continue
		const pMatch = /^participant\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i.exec(line)
		if (pMatch?.[1]) {
			ensureParticipant(pMatch[1])
			if (pMatch[2]) aliases.set(pMatch[1], pMatch[2].trim())
			continue
		}
		const msgMatch = /^([A-Za-z0-9_.-]+)\s*(--?>>|--?>|->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$/.exec(line)
		if (msgMatch?.[1] && msgMatch[2] && msgMatch[3] && msgMatch[4]) {
			ensureParticipant(msgMatch[1])
			ensureParticipant(msgMatch[3])
			messages.push({
				from: msgMatch[1],
				to: msgMatch[3],
				text: msgMatch[4].trim(),
				dashed: msgMatch[2].startsWith('--')
			})
		}
	}

	if (participants.length === 0) {
		return { ok: false, error: 'No sequence participants found. Example: Alice->>Bob: Hello' }
	}

	const colW = 160
	const padX = 24
	const headerH = 38
	const rowH = 44
	const width = padX * 2 + participants.length * colW
	const height = 70 + messages.length * rowH + 30
	const centerOf = (id: string) => padX + participants.indexOf(id) * colW + colW / 2

	const defs = `<defs><marker id="huriro-seq-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 8 5 L 0 9 z" fill="var(--primary)"/></marker></defs>`

	const lifelines = participants
		.map((id) => {
			const cx = centerOf(id)
			const label = aliases.get(id) ?? id
			return `<rect x="${cx - 58}" y="16" width="116" height="${headerH}" rx="6" fill="var(--card)" stroke="var(--border)" stroke-width="1.5"/><text x="${cx}" y="39" text-anchor="middle" font-size="12" font-weight="600" fill="var(--foreground)">${escapeXml(label.slice(0, 18))}</text><line x1="${cx}" y1="${16 + headerH}" x2="${cx}" y2="${height - 16}" stroke="var(--border)" stroke-dasharray="4 4" stroke-width="1.2"/>`
		})
		.join('')

	const arrows = messages
		.map((msg, idx) => {
			const y = 84 + idx * rowH
			const x1 = centerOf(msg.from)
			const x2 = centerOf(msg.to)
			const dashAttr = msg.dashed ? ' stroke-dasharray="5 4"' : ''
			const mx = (x1 + x2) / 2
			return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--primary)" stroke-width="1.5"${dashAttr} marker-end="url(#huriro-seq-arrow)"/><text x="${mx}" y="${y - 6}" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">${escapeXml(msg.text.slice(0, 40))}</text>`
		})
		.join('')

	return {
		ok: true,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;height:auto;font-family:var(--font-sans)">${defs}${lifelines}${arrows}</svg>`
	}
}

export function renderMermaidSvg(rawCode: string): MermaidRenderResult {
	const lines = rawCode
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
	if (lines.length === 0) {
		return { ok: false, error: 'Mermaid diagram source is empty' }
	}
	const header = lines[0] ?? ''
	const rest = lines.slice(1)
	if (/^(flowchart|graph)\b/i.test(header)) {
		return renderFlowchartSvg(header, rest)
	}
	if (/^sequenceDiagram\b/i.test(header)) {
		return renderSequenceSvg(rest)
	}
	if (/^stateDiagram(?:-v2)?\b/i.test(header)) {
		const mapped = rest.map((l) => l.replace(/\[\*\]/g, 'Start'))
		return renderFlowchartSvg('flowchart LR', mapped)
	}
	return {
		ok: false,
		error: 'Unsupported Mermaid header. Supported: flowchart, graph, sequenceDiagram, stateDiagram-v2'
	}
}
