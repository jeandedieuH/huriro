/**
 * Envelope encryption and webhook HMAC signing/verification (§12.7, §16.5, §16.6).
 */
import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual
} from 'node:crypto'

const ENVELOPE_SALT = Buffer.from('huriro-secret-envelope-salt', 'utf8')
const DEFAULT_DEV_ROOT_SECRET = 'huriro-dev-envelope-secret-do-not-use-in-prod-0000'

export function resolveRootEnvelopeSecret(configured?: string | undefined): string {
	return configured && configured.length >= 16 ? configured : DEFAULT_DEV_ROOT_SECRET
}

export function derivePurposeKey(rootSecret: string, purpose: string): Buffer {
	return Buffer.from(
		hkdfSync('sha256', Buffer.from(rootSecret, 'utf8'), ENVELOPE_SALT, Buffer.from(purpose, 'utf8'), 32)
	)
}

/** Encrypt plaintext with AES-256-GCM bound to tenant/entity AAD. */
export function encryptSecret(rootSecret: string, aad: string, plaintext: string): string {
	const key = derivePurposeKey(rootSecret, 'secret-envelope-v1')
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	cipher.setAAD(Buffer.from(aad, 'utf8'))
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	const tag = cipher.getAuthTag()
	return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`
}

/** Decrypt AES-256-GCM ciphertext; fails on AAD or tag mismatch. */
export function decryptSecret(rootSecret: string, aad: string, encoded: string): string {
	const parts = encoded.split(':')
	if (parts.length !== 4 || parts[0] !== 'v1') {
		throw new Error('Unsupported secret envelope format')
	}
	const key = derivePurposeKey(rootSecret, 'secret-envelope-v1')
	const iv = Buffer.from(parts[1]!, 'base64url')
	const tag = Buffer.from(parts[2]!, 'base64url')
	const ciphertext = Buffer.from(parts[3]!, 'base64url')
	const decipher = createDecipheriv('aes-256-gcm', key, iv)
	decipher.setAAD(Buffer.from(aad, 'utf8'))
	decipher.setAuthTag(tag)
	const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
	return plain.toString('utf8')
}

export function signWebhookPayload(secret: string, timestampSec: number, rawBody: string): string {
	const mac = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`, 'utf8').digest('hex')
	return `t=${timestampSec},v1=${mac}`
}

export function verifyWebhookSignature(
	secret: string,
	headerValue: string,
	rawBody: string,
	nowSec = Math.floor(Date.now() / 1000),
	maxSkewSec = 300
): boolean {
	const pairs = headerValue.split(',').map((s) => s.trim())
	let ts: number | null = null
	let sigHex: string | null = null
	for (const part of pairs) {
		if (part.startsWith('t=')) ts = Number.parseInt(part.slice(2), 10)
		else if (part.startsWith('v1=')) sigHex = part.slice(3)
	}
	if (ts === null || !Number.isFinite(ts) || !sigHex || !/^[0-9a-f]{64}$/i.test(sigHex)) {
		return false
	}
	if (Math.abs(nowSec - ts) > maxSkewSec) return false
	const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest()
	const provided = Buffer.from(sigHex, 'hex')
	return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export function verifyGithubSignature256(
	secret: string,
	rawBody: string,
	headerValue: string | null | undefined
): boolean {
	if (!headerValue || !headerValue.startsWith('sha256=')) return false
	const hex = headerValue.slice('sha256='.length).trim()
	if (!/^[0-9a-f]{64}$/i.test(hex)) return false
	const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest()
	const provided = Buffer.from(hex, 'hex')
	return expected.length === provided.length && timingSafeEqual(expected, provided)
}
