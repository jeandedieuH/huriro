/**
 * Magic-byte sniffing, EXIF/metadata stripping, and ClamAV / EICAR quarantine
 * scanning (§8.7, §12.6).
 */
import { connect } from 'node:net'

// Standard EICAR anti-malware test signature (constructed via concat so static scanners don't flag source).
const EICAR_SIGNATURE = `${'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-'}ANTIVIRUS-TEST-FILE!$H+H*`

/** Sniff content type strictly from magic bytes / structure; never trust client header (§12.6). */
export function sniffContentType(bytes: Uint8Array, filename?: string): string {
	if (bytes.byteLength >= 8) {
		// PNG: 89 50 4E 47 0D 0A 1A 0A
		if (
			bytes[0] === 0x89 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47 &&
			bytes[4] === 0x0d &&
			bytes[5] === 0x0a &&
			bytes[6] === 0x1a &&
			bytes[7] === 0x0a
		) {
			return 'image/png'
		}
	}
	if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg'
	}
	if (
		bytes.byteLength >= 6 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return 'image/gif'
	}
	if (
		bytes.byteLength >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp'
	}
	if (
		bytes.byteLength >= 5 &&
		bytes[0] === 0x25 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x46 &&
		bytes[4] === 0x2d
	) {
		return 'application/pdf'
	}
	if (
		bytes.byteLength >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	) {
		return 'application/zip'
	}

	const headText = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 512)))
		.toString('utf8')
		.trimStart()
		.toLowerCase()
	if (headText.startsWith('<svg') || (headText.startsWith('<?xml') && headText.includes('<svg'))) {
		return 'image/svg+xml'
	}
	if (
		headText.startsWith('<!doctype html') ||
		headText.startsWith('<html') ||
		headText.startsWith('<script')
	) {
		return 'text/html'
	}

	// Check printable UTF-8 text
	let controlCount = 0
	const checkLen = Math.min(bytes.byteLength, 1024)
	for (let i = 0; i < checkLen; i++) {
		const b = bytes[i]!
		if (b === 0) return 'application/octet-stream'
		if (b < 0x09 || (b > 0x0d && b < 0x20)) controlCount++
	}
	if (checkLen > 0 && controlCount === 0) {
		if (filename?.toLowerCase().endsWith('.json')) return 'application/json'
		if (filename?.toLowerCase().endsWith('.csv')) return 'text/csv'
		return 'text/plain'
	}
	return 'application/octet-stream'
}

/**
 * Strip JPEG APP1 (EXIF/XMP), APP13 (IPTC), COM segments and PNG metadata
 * chunks (`eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`) without corrupting pixels (§12.6).
 */
export function stripImageMetadata(
	bytes: Uint8Array,
	contentType: string
): { readonly bytes: Uint8Array; readonly reencoded: boolean } {
	if (contentType === 'image/jpeg') {
		return stripJpegMetadata(bytes)
	}
	if (contentType === 'image/png') {
		return stripPngMetadata(bytes)
	}
	return { bytes, reencoded: false }
}

function stripJpegMetadata(bytes: Uint8Array): { readonly bytes: Uint8Array; readonly reencoded: boolean } {
	if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		return { bytes, reencoded: false }
	}
	const out: Uint8Array[] = [bytes.subarray(0, 2)]
	let pos = 2
	let stripped = false

	while (pos + 1 < bytes.byteLength) {
		if (bytes[pos] !== 0xff) break
		while (pos < bytes.byteLength && bytes[pos] === 0xff) pos++
		if (pos >= bytes.byteLength) break
		const marker = bytes[pos]!
		pos++

		if (marker === 0xd9) {
			out.push(new Uint8Array([0xff, 0xd9]))
			break
		}
		if (marker === 0xda) {
			// Start of Scan: copy remaining stream untouched.
			out.push(new Uint8Array([0xff, marker]), bytes.subarray(pos))
			pos = bytes.byteLength
			break
		}
		if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			out.push(new Uint8Array([0xff, marker]))
			continue
		}
		if (pos + 1 >= bytes.byteLength) break
		const segLen = (bytes[pos]! << 8) | bytes[pos + 1]!
		if (segLen < 2 || pos + segLen > bytes.byteLength) {
			return { bytes, reencoded: false }
		}
		// Strip APP1 (EXIF/XMP), APP13 (IPTC), COM (comments).
		if (marker === 0xe1 || marker === 0xed || marker === 0xfe) {
			stripped = true
		} else {
			out.push(new Uint8Array([0xff, marker]), bytes.subarray(pos, pos + segLen))
		}
		pos += segLen
	}

	if (!stripped) return { bytes, reencoded: false }
	const total = out.reduce((acc, c) => acc + c.byteLength, 0)
	const merged = new Uint8Array(total)
	let offset = 0
	for (const chunk of out) {
		merged.set(chunk, offset)
		offset += chunk.byteLength
	}
	return { bytes: merged, reencoded: true }
}

const PNG_META_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

function stripPngMetadata(bytes: Uint8Array): { readonly bytes: Uint8Array; readonly reencoded: boolean } {
	if (bytes.byteLength < 8) return { bytes, reencoded: false }
	const out: Uint8Array[] = [bytes.subarray(0, 8)]
	let pos = 8
	let stripped = false

	while (pos + 12 <= bytes.byteLength) {
		const len =
			((bytes[pos]! << 24) | (bytes[pos + 1]! << 16) | (bytes[pos + 2]! << 8) | bytes[pos + 3]!) >>> 0
		const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!)
		const totalChunkLen = 12 + len
		if (pos + totalChunkLen > bytes.byteLength) {
			return { bytes, reencoded: false }
		}
		if (PNG_META_CHUNKS.has(type)) {
			stripped = true
		} else {
			out.push(bytes.subarray(pos, pos + totalChunkLen))
		}
		pos += totalChunkLen
		if (type === 'IEND') break
	}

	if (!stripped) return { bytes, reencoded: false }
	const total = out.reduce((acc, c) => acc + c.byteLength, 0)
	const merged = new Uint8Array(total)
	let offset = 0
	for (const chunk of out) {
		merged.set(chunk, offset)
		offset += chunk.byteLength
	}
	return { bytes: merged, reencoded: true }
}

export interface ScanOutcome {
	readonly status: 'clean' | 'infected' | 'failed' | 'unscanned'
	readonly detail: string
}

export async function scanBufferForMalware(
	bytes: Uint8Array,
	opts?: { readonly clamavHost?: string | undefined; readonly clamavPort?: number | undefined }
): Promise<ScanOutcome> {
	const asLatin1 = Buffer.from(bytes).toString('latin1')
	if (asLatin1.includes(EICAR_SIGNATURE)) {
		return { status: 'infected', detail: 'Eicar-Test-Signature FOUND' }
	}

	if (!opts?.clamavHost) {
		return { status: 'unscanned', detail: 'clamav_not_configured' }
	}

	return await streamToClamd(opts.clamavHost, opts.clamavPort ?? 3310, bytes)
}

function streamToClamd(host: string, port: number, bytes: Uint8Array): Promise<ScanOutcome> {
	return new Promise((resolve) => {
		const socket = connect({ host, port })
		const chunks: Buffer[] = []
		let settled = false

		const finish = (outcome: ScanOutcome) => {
			if (settled) return
			settled = true
			socket.destroy()
			resolve(outcome)
		}

		socket.setTimeout(10_000)
		socket.on('timeout', () => finish({ status: 'failed', detail: 'clamd_timeout' }))
		socket.on('error', (err) => finish({ status: 'failed', detail: `clamd_error: ${err.message}` }))
		socket.on('data', (data) => chunks.push(Buffer.from(data)))
		socket.on('end', () => {
			const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()
			if (reply.endsWith('FOUND')) {
				finish({ status: 'infected', detail: reply })
			} else if (reply.endsWith('OK')) {
				finish({ status: 'clean', detail: reply })
			} else {
				finish({ status: 'failed', detail: reply || 'clamd_empty_reply' })
			}
		})

		socket.on('connect', () => {
			socket.write('zINSTREAM\0')
			const chunkSize = 32 * 1024
			for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
				const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize))
				const lenBuf = Buffer.allocUnsafe(4)
				lenBuf.writeUInt32BE(slice.byteLength, 0)
				socket.write(lenBuf)
				socket.write(slice)
			}
			socket.write(Buffer.alloc(4)) // terminating zero-length chunk
		})
	})
}
