import { describe, expect, test } from 'bun:test'
import { parseSearchQuery } from './search-query'

describe('parseSearchQuery', () => {
	test('detects leading > actions mode', () => {
		const q = parseSearchQuery('  > create issue  ')
		expect(q.mode).toBe('actions')
		expect(q.freeText).toBe('create issue')
	})

	test('extracts exact issue key and typed operators', () => {
		const q = parseSearchQuery('in:eng is:open @alice label:"bug fix" priority:high type:issue ENG-142 retry')
		expect(q.mode).toBe('all')
		expect(q.projectKey).toBe('ENG')
		expect(q.state).toBe('open')
		expect(q.assigneeHandle).toBe('alice')
		expect(q.labels).toEqual(['bug fix'])
		expect(q.priority).toBe(3)
		expect(q.entityType).toBe('issue')
		expect(q.issueIdentifier).toEqual({ projectKey: 'ENG', number: 142 })
		expect(q.freeText).toBe('ENG-142 retry')
	})

	test('handles empty input safely', () => {
		const q = parseSearchQuery('   ')
		expect(q.mode).toBe('all')
		expect(q.freeText).toBe('')
		expect(q.issueIdentifier).toBeNull()
	})

	test('normalizes type:doc and type:doc_page to doc_page', () => {
		expect(parseSearchQuery('type:doc architecture').entityType).toBe('doc_page')
		expect(parseSearchQuery('type:doc_page runbook').entityType).toBe('doc_page')
	})
})
