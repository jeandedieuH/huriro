/**
 * Shared axios client for every API call in the web app.
 *
 * - `baseURL` is `VITE_API_URL` when set; unset means same-origin (dev proxy /
 *   single-ingress deploy), so relative paths are used as-is.
 * - `withCredentials` carries the better-auth session cookie (fetch's
 *   `credentials: 'include'` equivalent).
 * - `x-huriro-client` is the CSRF marker the api expects on session traffic.
 * - `validateStatus` resolves on ANY HTTP status — matching fetch semantics,
 *   so call sites keep explicit status checks instead of catch-based control
 *   flow. Rejections happen only on network-level failures.
 *
 * Tests stub `api.defaults.adapter` to intercept requests — never
 * `globalThis.fetch`.
 */
import axios from 'axios'
import { env } from './env'

export const API_BASE = env.VITE_API_URL ?? ''

export const api = axios.create({
	...(API_BASE ? { baseURL: API_BASE } : {}),
	withCredentials: true,
	validateStatus: () => true,
	headers: { 'x-huriro-client': 'huriro-web' }
})
