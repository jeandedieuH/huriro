import { check, sleep } from 'k6'
import http from 'k6/http'

const BASE_URL = __ENV.HURIRO_BASE_URL || 'http://127.0.0.1:3001'
const AUTH_COOKIE = __ENV.HURIRO_SESSION_COOKIE || ''
const WORKSPACE_ID = __ENV.HURIRO_WORKSPACE_ID || ''

export const options = {
	scenarios: {
		steady_ga_mix: {
			executor: 'ramping-arrival-rate',
			startRate: 10,
			timeUnit: '1s',
			preAllocatedVUs: 25,
			maxVUs: 100,
			stages: [
				{ target: 25, duration: '30s' },
				{ target: 50, duration: '1m' },
				{ target: 10, duration: '20s' }
			]
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.005'],
		http_req_duration: ['p(95)<200', 'p(99)<500']
	}
}

export default function () {
	const health = http.get(`${BASE_URL}/healthz`)
	check(health, { 'healthz 200': (r) => r.status === 200 })

	const ready = http.get(`${BASE_URL}/readyz`)
	check(ready, { 'readyz 200': (r) => r.status === 200 })

	if (AUTH_COOKIE && WORKSPACE_ID) {
		const headers = {
			cookie: AUTH_COOKIE,
			'x-workspace-id': WORKSPACE_ID,
			'x-huriro-client': 'huriro-k6'
		}
		const sync = http.get(`${BASE_URL}/api/v1/sync/changes?cursor=0`, { headers })
		check(sync, { 'sync changes 200': (r) => r.status === 200 })

		const issues = http.get(`${BASE_URL}/api/v1/issues`, { headers })
		check(issues, { 'issues 200': (r) => r.status === 200 })

		const channels = http.get(`${BASE_URL}/api/v1/chat/channels`, { headers })
		check(channels, { 'chat channels 200': (r) => r.status === 200 })
	}

	sleep(0.2)
}
