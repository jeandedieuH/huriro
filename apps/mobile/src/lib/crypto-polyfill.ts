/**
 * Mobile WebCrypto polyfill for React Native / Hermes on Expo SDK 58.
 *
 * Expo's native WinterCG runtime (`expo/src/winter/runtime.native.ts`) does not
 * install `globalThis.crypto`, while `@huriro/sync-client` (`generateUuidV7`) and
 * `@tanstack/db` require `crypto.getRandomValues` and `crypto.randomUUID`.
 * `expo-modules-core` natively exposes `globalThis.expo.uuidv4()` backed by the
 * OS CSPRNG on both iOS and Android, so we derive random bytes from it without
 * requiring any extra native dependency or native binary rebuild.
 */

export interface MobileCryptoLike {
	getRandomValues?: (<T extends ArrayBufferView>(array: T) => T) | undefined
	randomUUID?: (() => `${string}-${string}-${string}-${string}-${string}`) | undefined
}

export interface MobileExpoGlobalLike {
	readonly uuidv4?: (() => string) | undefined
}

export interface MobileCryptoGlobalTarget {
	crypto?: MobileCryptoLike | undefined
	readonly expo?: MobileExpoGlobalLike | undefined
}

export type UuidString = `${string}-${string}-${string}-${string}-${string}`

const MAX_RANDOM_BYTES = 65_536

// Canonical UUID v4 layout: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (36 chars).
// Byte 6 (offset 14) carries the fixed version nibble `4` and byte 8 (offset 19)
// carries the fixed RFC 4122 variant bits `10xxxxxx`. We skip both so every
// extracted byte carries a full 8 bits of OS CSPRNG entropy (14 bytes per call).
const UUID_V4_RANDOM_BYTE_OFFSETS = [0, 2, 4, 6, 9, 11, 16, 21, 24, 26, 28, 30, 32, 34] as const

function isSupportedIntegerTypedArray(value: unknown): value is ArrayBufferView {
	return (
		value instanceof Int8Array ||
		value instanceof Uint8Array ||
		value instanceof Uint8ClampedArray ||
		value instanceof Int16Array ||
		value instanceof Uint16Array ||
		value instanceof Int32Array ||
		value instanceof Uint32Array ||
		(typeof BigInt64Array === 'function' && value instanceof BigInt64Array) ||
		(typeof BigUint64Array === 'function' && value instanceof BigUint64Array)
	)
}

function parseHexNibble(charCode: number): number {
	if (charCode >= 48 && charCode <= 57) return charCode - 48
	if (charCode >= 97 && charCode <= 102) return charCode - 87
	if (charCode >= 65 && charCode <= 70) return charCode - 55
	return -1
}

function parseHexByte(uuid: string, offset: number): number {
	const high = parseHexNibble(uuid.charCodeAt(offset))
	const low = parseHexNibble(uuid.charCodeAt(offset + 1))
	if (high < 0 || low < 0) {
		throw new Error('expo.uuidv4 returned non-hex characters')
	}
	return (high << 4) | low
}

function formatUuidV4FromBytes(bytes: Uint8Array): UuidString {
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UuidString
}

function createQuotaExceededError(byteLength: number): Error {
	const message = `Failed to execute 'getRandomValues' on 'Crypto': The ArrayBufferView's byte length (${byteLength}) exceeds the number of bytes of entropy available via this API (${MAX_RANDOM_BYTES}).`
	if (typeof DOMException === 'function') {
		return new DOMException(message, 'QuotaExceededError')
	}
	return new RangeError(message)
}

function assertCanonicalUuidString(uuid: unknown): asserts uuid is string {
	if (
		typeof uuid !== 'string' ||
		uuid.length !== 36 ||
		uuid[8] !== '-' ||
		uuid[13] !== '-' ||
		uuid[18] !== '-' ||
		uuid[23] !== '-'
	) {
		throw new Error('expo.uuidv4 returned an invalid UUID string')
	}
}

function createGetRandomValues(target: MobileCryptoGlobalTarget) {
	return function getRandomValues<T extends ArrayBufferView>(array: T): T {
		if (!isSupportedIntegerTypedArray(array)) {
			throw new TypeError('crypto.getRandomValues requires an integer TypedArray')
		}
		if (array.byteLength > MAX_RANDOM_BYTES) {
			throw createQuotaExceededError(array.byteLength)
		}
		if (array.byteLength === 0) {
			return array
		}

		const nativeUuidV4 = target.expo?.uuidv4
		if (typeof nativeUuidV4 !== 'function') {
			throw new Error('Mobile WebCrypto polyfill requires globalThis.expo.uuidv4 from expo-modules-core')
		}

		const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
		let written = 0
		while (written < bytes.length) {
			const uuid = nativeUuidV4()
			assertCanonicalUuidString(uuid)
			for (let i = 0; i < UUID_V4_RANDOM_BYTE_OFFSETS.length && written < bytes.length; i += 1) {
				const offset = UUID_V4_RANDOM_BYTE_OFFSETS[i]
				if (offset === undefined) continue
				bytes[written] = parseHexByte(uuid, offset)
				written += 1
			}
		}

		return array
	}
}

function createRandomUUID(target: MobileCryptoGlobalTarget) {
	return function randomUUID(): UuidString {
		const nativeUuidV4 = target.expo?.uuidv4
		if (typeof nativeUuidV4 === 'function') {
			const uuid = nativeUuidV4()
			assertCanonicalUuidString(uuid)
			return uuid.toLowerCase() as UuidString
		}

		const existingGetRandomValues = target.crypto?.getRandomValues
		if (typeof existingGetRandomValues === 'function') {
			const bytes = new Uint8Array(16)
			existingGetRandomValues.call(target.crypto, bytes)
			return formatUuidV4FromBytes(bytes)
		}

		throw new Error('Mobile WebCrypto polyfill requires globalThis.expo.uuidv4 or crypto.getRandomValues')
	}
}

/**
 * Installs `crypto.getRandomValues` and `crypto.randomUUID` on `target` when missing,
 * leaving any native WebCrypto implementation untouched.
 */
export function installMobileCryptoPolyfill(
	target: MobileCryptoGlobalTarget = globalThis as unknown as MobileCryptoGlobalTarget
): void {
	const existing = target.crypto
	const hasGetRandomValues = typeof existing?.getRandomValues === 'function'
	const hasRandomUUID = typeof existing?.randomUUID === 'function'
	if (hasGetRandomValues && hasRandomUUID) {
		return
	}

	const getRandomValues = createGetRandomValues(target)
	const randomUUID = createRandomUUID(target)

	if (!existing) {
		const polyfill: MobileCryptoLike = { getRandomValues, randomUUID }
		try {
			Object.defineProperty(target, 'crypto', {
				value: polyfill,
				configurable: true,
				enumerable: true,
				writable: true
			})
		} catch {
			target.crypto = polyfill
		}
		return
	}

	if (!hasGetRandomValues) {
		try {
			Object.defineProperty(existing, 'getRandomValues', {
				value: getRandomValues,
				configurable: true,
				enumerable: true,
				writable: true
			})
		} catch {
			// Host froze `crypto`; leave unchanged.
		}
	}

	if (!hasRandomUUID) {
		try {
			Object.defineProperty(existing, 'randomUUID', {
				value: randomUUID,
				configurable: true,
				enumerable: true,
				writable: true
			})
		} catch {
			// Host froze `crypto`; leave unchanged.
		}
	}
}

installMobileCryptoPolyfill()
