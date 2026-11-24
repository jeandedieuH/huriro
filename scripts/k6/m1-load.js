// M1 Gate G1 load test (§23, §4.3): 200 concurrent VUs mixing reads, writes,
// delta pulls, and search against the standard deployment shape.
// Run: k6 run -e BASE_URL=http://localhost:3001 -e WORKSPACE_ID=... -e AUTH_COOKIE=... scripts/k6/m1-load.js

import { check, sleep } from 'k6'
import http from 'k6/http'

export const options = {
	scenarios: {
		mixed_workspace_traffic: {
			executor: 'ramping-vus',
			startVUs: 10,
			stages: [
				{ duration: '30s', target: 100 },
				{ duration: '60s', target: 200 },
				{ duration: '30s', target: 0 }
			]
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		'http_req_duration{kind:read_list}': ['p(95)<250'],
		'http_req_duration{kind:read_sync}': ['p(95)<120'],
		'http_req_duration{kind:search}': ['p(95)<150'],
		'http_req_duration{kind:write_issue}': ['p(95)<300']
	}
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001'
const WORKSPACE_ID = __ENV.WORKSPACE_ID || ''
const PROJECT_ID = __ENV.PROJECT_ID || ''
const AUTH_COOKIE = __ENV.AUTH_COOKIE || ''

function headers(extra = {}) {
	return {
		'content-type': 'application/json',
		'x-workspace-id': WORKSPACE_ID,
		'x-huriro-client': 'k6-load',
		...(AUTH_COOKIE ? { cookie: AUTH_COOKIE } : {}),
		...extra
	}
}

export default function () {
	const r1 = http.get(`${BASE_URL}/api/v1/issues?limit=50`, {
		headers: headers(),
		tags: { kind: 'read_list' }
	})
	check(r1, { 'issues list 200': (r) => r.status === 200 })

	const r2 = http.get(`${BASE_URL}/api/v1/sync/changes?since=0&limit=100`, {
		headers: headers(),
		tags: { kind: 'read_sync' }
	})
	check(r2, { 'sync changes 200': (r) => r.status === 200 })

	const r3 = http.get(`${BASE_URL}/api/v1/search?q=bug&limit=10`, {
		headers: headers(),
		tags: { kind: 'search' }
	})
	check(r3, { 'search 200': (r) => r.status === 200 })

	if (__ITER % 5 === 0 && PROJECT_ID) {
		const w = http.post(
			`${BASE_URL}/api/v1/issues`,
			JSON.stringify({
				projectId: PROJECT_ID,
				title: `Load test issue vu=${__VU} iter=${__ITER}`,
				priority: 2
			}),
			{
				headers: headers({ 'idempotency-key': `k6-${__VU}-${__ITER}` }),
				tags: { kind: 'write_issue' }
			}
		)
		check(w, { 'issue created 201': (r) => r.status === 201 })
	}

	sleep(0.5)
}
