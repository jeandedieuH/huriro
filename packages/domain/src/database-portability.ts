/** CSV/JSON portability helpers for structured databases. Pure so import preview and server export share semantics. */

export interface PortableDatabaseProperty {
	readonly id: string
	readonly name: string
	readonly propType: string
}

export interface PortableCellInput {
	readonly text?: string | null
	readonly number?: number | null
	readonly boolean?: boolean | null
	readonly dateStart?: string | null
	readonly dateEnd?: string | null
	readonly json?: unknown
}

export interface PortableDatabaseRowInput {
	readonly title: string
	readonly cells: Record<string, PortableCellInput>
}

function emptyCell(): Required<PortableCellInput> {
	return { text: null, number: null, boolean: null, dateStart: null, dateEnd: null, json: null }
}

/** RFC4180-style CSV parser with quoted-cell, escaped-quote, CR/LF support. Input is caller-size-capped. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = []
	let row: string[] = []
	let cell = ''
	let quoted = false
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cell += '"'
					i++
				} else quoted = false
			} else cell += ch
			continue
		}
		if (ch === '"' && cell.length === 0) {
			quoted = true
			continue
		}
		if (ch === ',') {
			row.push(cell)
			cell = ''
			continue
		}
		if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++
			row.push(cell)
			cell = ''
			if (row.some((v) => v.length > 0)) rows.push(row)
			row = []
			continue
		}
		cell += ch
	}
	row.push(cell)
	if (row.some((v) => v.length > 0)) rows.push(row)
	return rows
}

function csvEscape(value: unknown): string {
	const s =
		value === null || value === undefined
			? ''
			: typeof value === 'object'
				? JSON.stringify(value)
				: String(value)
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function serializeCsv(rows: readonly (readonly unknown[])[]): string {
	return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

function parseScalar(raw: string, propType: string): PortableCellInput {
	const value = raw.trim()
	if (value === '') return emptyCell()
	if (propType === 'number') {
		const n = Number(value)
		return Number.isFinite(n) ? { ...emptyCell(), number: n } : emptyCell()
	}
	if (propType === 'checkbox')
		return { ...emptyCell(), boolean: ['true', '1', 'yes', 'y', 'checked'].includes(value.toLowerCase()) }
	if (propType === 'date') {
		const ms = Date.parse(value)
		return Number.isFinite(ms) ? { ...emptyCell(), dateStart: new Date(ms).toISOString() } : emptyCell()
	}
	if (
		propType === 'multi_select' ||
		propType === 'person' ||
		propType === 'file' ||
		propType === 'relation'
	) {
		try {
			const parsed = JSON.parse(value)
			return {
				...emptyCell(),
				json: Array.isArray(parsed)
					? parsed
					: value
							.split(';')
							.map((v) => v.trim())
							.filter(Boolean)
			}
		} catch {
			return {
				...emptyCell(),
				json: value
					.split(';')
					.map((v) => v.trim())
					.filter(Boolean)
			}
		}
	}
	return { ...emptyCell(), text: value }
}

function propertyByHeader(
	properties: readonly PortableDatabaseProperty[]
): Map<string, PortableDatabaseProperty> {
	const map = new Map<string, PortableDatabaseProperty>()
	for (const prop of properties) {
		map.set(prop.id.toLowerCase(), prop)
		map.set(prop.name.toLowerCase(), prop)
	}
	return map
}

/** Convert CSV text into sparse typed row inputs. First row is a header; a title column supplies row.title. */
export function databaseRowsFromCsv(
	text: string,
	properties: readonly PortableDatabaseProperty[]
): PortableDatabaseRowInput[] {
	const rows = parseCsv(text)
	const header = rows[0]
	if (!header) return []
	const byHeader = propertyByHeader(properties)
	return rows.slice(1).map((values) => {
		let title = ''
		const cells: Record<string, PortableCellInput> = {}
		for (let i = 0; i < header.length; i++) {
			const key = String(header[i] ?? '')
				.trim()
				.toLowerCase()
			const prop = byHeader.get(key)
			if (!prop) continue
			const raw = String(values[i] ?? '')
			if (prop.propType === 'title') title = raw
			else cells[prop.id] = parseScalar(raw, prop.propType)
		}
		return { title, cells }
	})
}

/** Convert JSON arrays of objects keyed by property id/name into sparse typed inputs. */
export function databaseRowsFromJson(
	text: string,
	properties: readonly PortableDatabaseProperty[]
): PortableDatabaseRowInput[] {
	const parsed = JSON.parse(text) as unknown
	if (!Array.isArray(parsed)) throw new Error('JSON import must be an array of row objects')
	const byHeader = propertyByHeader(properties)
	return parsed.map((item) => {
		const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
		let title = typeof record['title'] === 'string' ? record['title'] : ''
		const cells: Record<string, PortableCellInput> = {}
		for (const [key, value] of Object.entries(record)) {
			const prop = byHeader.get(key.toLowerCase())
			if (!prop) continue
			if (prop.propType === 'title') {
				title = typeof value === 'string' ? value : title
				continue
			}
			if (value === null || value === undefined) cells[prop.id] = emptyCell()
			else if (prop.propType === 'number' && typeof value === 'number')
				cells[prop.id] = { ...emptyCell(), number: value }
			else if (prop.propType === 'checkbox' && typeof value === 'boolean')
				cells[prop.id] = { ...emptyCell(), boolean: value }
			else if (prop.propType === 'date' && typeof value === 'string')
				cells[prop.id] = { ...emptyCell(), dateStart: value }
			else if (typeof value === 'object') cells[prop.id] = { ...emptyCell(), json: value }
			else cells[prop.id] = { ...emptyCell(), text: String(value) }
		}
		return { title, cells }
	})
}

export function portableCellDisplay(cell: PortableCellInput | undefined): unknown {
	if (!cell) return ''
	return cell.text ?? cell.number ?? cell.boolean ?? cell.dateStart ?? cell.json ?? ''
}

/** Serialize rows to CSV using property names as stable human-readable headers. */
export function databaseRowsToCsv(
	rows: readonly { title: string; cells: Record<string, PortableCellInput> }[],
	properties: readonly PortableDatabaseProperty[]
): string {
	const visible = properties.filter((p) => p.propType !== 'title')
	return serializeCsv([
		['title', ...visible.map((p) => p.name)],
		...rows.map((row) => [row.title, ...visible.map((p) => portableCellDisplay(row.cells[p.id]))])
	])
}

export function databaseRowsToJson(
	rows: readonly { title: string; cells: Record<string, PortableCellInput> }[],
	properties: readonly PortableDatabaseProperty[]
): string {
	return JSON.stringify(
		rows.map((row) => {
			const out: Record<string, unknown> = { title: row.title }
			for (const prop of properties) {
				if (prop.propType === 'title') continue
				out[prop.name] = portableCellDisplay(row.cells[prop.id])
			}
			return out
		}),
		null,
		2
	)
}
