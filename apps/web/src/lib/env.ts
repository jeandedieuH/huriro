/**
 * Client env, validated once at module load — a bad `VITE_*` value fails the
 * boot gate instead of a random route later. All vars are optional: unset
 * means "same-origin" (dev proxy on :3000, or a single-ingress deploy).
 */
import { createWebEnv } from '@huriro/env/web'

export const env = createWebEnv(import.meta.env)
