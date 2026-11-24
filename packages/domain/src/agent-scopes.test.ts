/**
 * Agent scope → action mapping and risk-tier math (§13.3, §13.5).
 * Invariants under test:
 *   - the mapping is total: every AGENT_SCOPES entry has a row and vice versa
 *   - no *.read scope implies a write/manage action
 *   - actionsForScopes = token scopes ∩ ceiling scopes (both ways)
 *   - effectiveRisk only ever raises; R3 is never agent-executable
 */
import { describe, expect, test } from 'bun:test'
import {
	AGENT_SCOPES,
	actionsForScopes,
	effectiveRisk,
	isAgentExecutable,
	isAgentScope,
	SCOPE_ACTIONS
} from './agent-scopes'
import { ACTIONS, type Action } from './permissions'

const WRITE_ACTIONS = new Set<Action>([
	'project.write',
	'issue.write',
	'doc.write',
	'doc.comment',
	'channel.post',
	'file.write',
	'mail.assign',
	'mail.send'
])

describe('AGENT_SCOPES', () => {
	test('mapping is total and actions are catalog members', () => {
		expect(Object.keys(SCOPE_ACTIONS).sort()).toEqual([...AGENT_SCOPES].sort())
		for (const scope of AGENT_SCOPES) {
			for (const action of SCOPE_ACTIONS[scope]) {
				expect(ACTIONS).toContain(action)
			}
		}
	})

	test('no read scope implies a write action', () => {
		for (const scope of AGENT_SCOPES.filter((s) => s.endsWith('.read'))) {
			for (const action of SCOPE_ACTIONS[scope]) {
				expect(WRITE_ACTIONS.has(action), `${scope} → ${action}`).toBe(false)
			}
		}
	})

	test('isAgentScope accepts only catalog scopes', () => {
		expect(isAgentScope('tasks.read')).toBe(true)
		expect(isAgentScope('openid')).toBe(false)
		expect(isAgentScope('tasks.delete')).toBe(false)
	})
})

describe('actionsForScopes', () => {
	test('token ∩ ceiling intersection', () => {
		expect(actionsForScopes(['tasks.read'], ['tasks.read'])).toEqual(new Set(['project.read', 'issue.read']))
		// Token asks for write but ceiling only holds read.
		expect(actionsForScopes(['tasks.read', 'tasks.write'], ['tasks.read'])).toEqual(
			new Set(['project.read', 'issue.read'])
		)
		// Ceiling holds write but token only carries read.
		expect(actionsForScopes(['tasks.read'], ['tasks.read', 'tasks.write'])).toEqual(
			new Set(['project.read', 'issue.read'])
		)
	})

	test('OIDC and unknown scopes are ignored, not errors', () => {
		expect(actionsForScopes(['openid', 'profile', 'tasks.read'], ['openid', 'tasks.read', 'bogus'])).toEqual(
			new Set(['project.read', 'issue.read'])
		)
		expect(actionsForScopes(['openid'], ['openid'])).toEqual(new Set())
	})

	test('marker scopes map to no actions', () => {
		expect(actionsForScopes(['mail.draft', 'search.read'], ['mail.draft', 'search.read'])).toEqual(new Set())
	})
})

describe('effectiveRisk', () => {
	test('workspace can only raise, never lower', () => {
		expect(effectiveRisk('R0', 'R2')).toBe('R2')
		expect(effectiveRisk('R2', 'R0')).toBe('R2')
		expect(effectiveRisk('R1')).toBe('R1')
		expect(effectiveRisk('R1', null)).toBe('R1')
		expect(effectiveRisk('R3', 'R0')).toBe('R3')
	})

	test('R3 is never agent-executable', () => {
		expect(isAgentExecutable('R3')).toBe(false)
		expect(isAgentExecutable(effectiveRisk('R0', 'R3'))).toBe(false)
		expect(isAgentExecutable('R2')).toBe(true)
	})
})
