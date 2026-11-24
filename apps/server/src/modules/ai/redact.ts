/**
 * Secret/PII redaction before egress (§11.3 policy layer). Deterministic
 * regex scrubber — runs on every prompt body BEFORE it leaves the server,
 * regardless of provider. Pure: no I/O, testable.
 */

const PATTERNS: readonly { re: RegExp; replacement: string }[] = [
	// Huriro + common API-key shapes
	{ re: /\bhrk_[A-Za-z0-9_-]{4,}/g, replacement: '[redacted:api-key]' },
	{ re: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: '[redacted:api-key]' },
	{ re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}/g, replacement: '[redacted:token]' },
	{ re: /\bxox[baprs]-[A-Za-z0-9-]{8,}/g, replacement: '[redacted:token]' },
	{ re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[redacted:aws-key]' },
	{ re: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: '[redacted:gcp-key]' },
	// Bearer/JWT-ish tokens (three dot-separated base64url segments)
	{ re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: '[redacted:jwt]' },
	{ re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replacement: 'Bearer [redacted]' },
	// Key=value secrets
	{
		re: /\b(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"]?[^\s'";]{6,}['"]?/gi,
		replacement: '$1=[redacted]'
	},
	// Email addresses (light PII scrub per §22 default)
	{ re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[redacted:email]' },
	// Connection strings with embedded credentials
	{
		re: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s@]+@[^\s]+/gi,
		replacement: '[redacted:connstr]'
	}
]

export function redactSecrets(text: string): string {
	let out = text
	for (const p of PATTERNS) out = out.replace(p.re, p.replacement)
	return out
}
