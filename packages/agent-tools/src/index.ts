export { getTool, TOOLS, type ToolSpec } from './registry'

import type { Static } from 'typebox'
import { TOOLS } from './registry'

/**
 * JSON manifest of every tool â€” consumed by the CLI generator, the OpenAPI
 * agent-operations generator, and the MCP adapter (Â§13.1a). Schemas are
 * emitted as TypeBox JSON Schema, which is JSON Schema draft-07+ compatible.
 */
export function toolManifest(): ReadonlyArray<{
	name: string
	title: string
	description: string
	input: unknown
	output: unknown
	scope: string
	tier: string
	kind: 'read' | 'write'
	untrustedFields?: readonly string[] | undefined
	idempotent: boolean
	undoable?: boolean | undefined
}> {
	return [...TOOLS.values()].map((t) => ({
		name: t.name,
		title: t.title,
		description: t.description,
		input: t.input as unknown as Static<typeof t.input>,
		output: t.output as unknown as Static<typeof t.output>,
		scope: t.scope,
		tier: t.tier,
		kind: t.kind,
		untrustedFields: t.untrustedFields,
		idempotent: t.idempotent,
		undoable: t.undoable
	}))
}
