// RFC 8628 device flow against better-auth's oauthDeviceAuthorization plugin
// (client `huriro-cli`, REST audience resource <url>/api/v1/agent).
import { postAuthEndpoint } from './http'
import type { Io } from './io'

export const CLI_CLIENT_ID = 'huriro-cli'
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

export interface DeviceStart {
	readonly deviceCode: string
	readonly userCode: string
	readonly verificationUri?: string | undefined
	readonly verificationUriComplete?: string | undefined
	readonly interval: number
	readonly expiresIn: number
}

export async function startDeviceFlow(
	io: Io,
	server: string,
	scope: string
): Promise<DeviceStart | { error: string }> {
	const res = await postAuthEndpoint(io, server, '/device/code', {
		client_id: CLI_CLIENT_ID,
		scope,
		resource: `${server}/api/v1/agent`
	})
	if (!res.ok)
		return { error: `device start failed (${res.status}): ${(res.json['error'] as string) ?? 'unknown'}` }
	const j = res.json
	if (typeof j['device_code'] !== 'string' || typeof j['user_code'] !== 'string') {
		return { error: `unexpected device response: ${JSON.stringify(j)}` }
	}
	return {
		deviceCode: j['device_code'],
		userCode: j['user_code'],
		verificationUri: j['verification_uri'] as string | undefined,
		verificationUriComplete: j['verification_uri_complete'] as string | undefined,
		interval: typeof j['interval'] === 'number' ? j['interval'] : 5,
		expiresIn: typeof j['expires_in'] === 'number' ? j['expires_in'] : 600
	}
}

export interface DeviceTokens {
	readonly accessToken: string
	readonly refreshToken?: string | undefined
	readonly expiresIn?: number | undefined
	readonly scope?: string | undefined
}

/**
 * Poll the token endpoint until approval, denial, or expiry.
 * RFC 8628: `slow_down` bumps interval +5s; `authorization_pending` waits.
 */
export async function pollDeviceTokens(
	io: Io,
	server: string,
	deviceCode: string,
	start: { interval: number; expiresIn: number }
): Promise<DeviceTokens | { error: string }> {
	let interval = Math.max(1, start.interval)
	const deadline = Date.now() + start.expiresIn * 1000
	for (let attempt = 0; attempt < 200; attempt++) {
		await io.sleep(interval * 1000)
		const res = await postAuthEndpoint(io, server, '/oauth2/token', {
			grant_type: DEVICE_GRANT,
			device_code: deviceCode,
			client_id: CLI_CLIENT_ID
		})
		const j = res.json
		if (res.ok && typeof j['access_token'] === 'string') {
			return {
				accessToken: j['access_token'],
				refreshToken: j['refresh_token'] as string | undefined,
				expiresIn: j['expires_in'] as number | undefined,
				scope: j['scope'] as string | undefined
			}
		}
		const err = j['error'] as string | undefined
		if (res.status === 429) {
			// Throttled — back off rather than hammering the token endpoint.
			interval += 5
			if (Date.now() > deadline) return { error: 'device code expired' }
			continue
		}
		if (err === 'authorization_pending') {
			if (Date.now() > deadline) return { error: 'device code expired' }
			continue
		}
		if (err === 'slow_down') {
			interval += 5
			continue
		}
		return { error: err ?? `token poll failed (${res.status})` }
	}
	return { error: 'device approval timed out' }
}

/** Refresh an access token; returns fresh tokens or null on invalid_grant. */
export async function refreshTokens(
	io: Io,
	server: string,
	refreshToken: string
): Promise<DeviceTokens | null> {
	const res = await postAuthEndpoint(io, server, '/oauth2/token', {
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: CLI_CLIENT_ID
	})
	if (!res.ok || typeof res.json['access_token'] !== 'string') return null
	return {
		accessToken: res.json['access_token'],
		refreshToken: res.json['refresh_token'] as string | undefined,
		expiresIn: res.json['expires_in'] as number | undefined,
		scope: res.json['scope'] as string | undefined
	}
}

/** RFC 7009 revocation (logout); absence of the endpoint is tolerated. */
export async function revokeToken(io: Io, server: string, token: string): Promise<void> {
	try {
		await postAuthEndpoint(io, server, '/oauth2/revoke', { token, client_id: CLI_CLIENT_ID })
	} catch {
		/* best effort — local creds are deleted regardless */
	}
}
