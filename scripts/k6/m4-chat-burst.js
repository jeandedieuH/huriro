// M4 Gate G4 (§23.2): 500-message concurrent channel burst & incremental sync delta pull SLO test.
// Run: k6 run -e BASE_URL=http://localhost:3001 -e WORKSPACE_ID=... -e CHANNEL_ID=... -e AUTH_COOKIE=... scripts/k6/m4-chat-burst.js
import http from 'k6/http'
import { check } from 'k6'

export const options = {
	scenarios: {
		channel_message_burst: {
			executor: 'shared-iterations',
			vus: 25,
			iterations: 500,
			maxDuration: '30s'
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		'http_req_duration{kind:chat_send}': ['p(95)<150'],
		'http_req_duration{kind:chat_changes}': ['p(95)<100']
	}
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001'
const WORKSPACE_ID = __ENV.WORKSPACE_ID || ''
const CHANNEL_ID = __ENV.CHANNEL_ID || ''
const AUTH_COOKIE = __ENV.AUTH_COOKIE || ''

function headers(extra = {}) {
	return {
		'content-type': 'application/json',
		'x-workspace-id': WORKSPACE_ID,
		'x-huriro-client': 'k6-chat-burst',
		...(AUTH_COOKIE ? { cookie: AUTH_COOKIE } : {}),
		...extra
	}
}

export default function () {
	if (!CHANNEL_ID || !WORKSPACE_ID) return

	const sendRes = http.post(
		`${BASE_URL}/api/v1/chat/channels/${CHANNEL_ID}/messages`,
		JSON.stringify({
			clientId: `k6-msg-${__VU}-${__ITER}`,
			bodyText: `k6 burst message vu=${__VU} iter=${__ITER}`
		}),
		{
			headers: headers(),
			tags: { kind: 'chat_send' }
		}
	)
	check(sendRes, { 'chat message 201': (r) => r.status === 201 })

	if (__ITER % 5 === 0) {
		const seq = Math.max(0, __ITER * 10 - 50)
		const deltaRes = http.get(
			`${BASE_URL}/api/v1/chat/channels/${CHANNEL_ID}/changes?since=${seq}&limit=100`,
			{
				headers: headers(),
				tags: { kind: 'chat_changes' }
			}
		)
		check(deltaRes, { 'chat changes 200': (r) => r.status === 200 })
	}
}
