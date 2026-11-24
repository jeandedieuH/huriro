/**
 * Breaking-change guard (§16.4): regenerating the OpenAPI doc must reproduce
 * the checked-in `docs/api/openapi.json` byte-for-byte. A diff means the wire
 * contract changed — update the generated files with `bun run gen` and review.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildArtifacts } from '../cli/genapi'

const API_DIR = resolve(import.meta.dir, '..', '..', '..', '..', 'docs', 'api')

describe('generated API artifacts (genapi snapshot)', () => {
	test('openapi.json, reference.md, llms.txt match the checked-in outputs', async () => {
		const artifacts = new Map(await buildArtifacts())
		for (const name of ['openapi.json', 'reference.md', 'llms.txt'] as const) {
			const expected = readFileSync(resolve(API_DIR, name), 'utf8')
			const actual = artifacts.get(resolve(API_DIR, name))
			expect(actual === undefined ? 'missing artifact' : actual).toBe(expected)
		}
		// The served /llms.txt module must be in sync with the checked-in text.
		const genTs = artifacts.get(resolve(import.meta.dir, 'llms-txt.gen.ts'))
		expect(genTs).toBe(readFileSync(resolve(import.meta.dir, 'llms-txt.gen.ts'), 'utf8'))
	})
})
