/**
 * @huriro/i18n — typed message catalog + Lingui i18n instance (§17.8).
 * `t(id)` is the typed shortcut; `<Trans>` works for JSX interpolation.
 */
import { i18n } from '@lingui/core'
import { en, type MessageId } from '../locales/en'
import { pseudo } from '../locales/pseudo'

export type { MessageId }
export { i18n }
export const locales = { en: 'English', pseudo: 'Pseudo (test)' } as const
export type Locale = keyof typeof locales

const catalogs: Record<Locale, Record<string, string>> = { en, pseudo }

export function activateI18n(locale: Locale = 'en') {
	i18n.load(locale, catalogs[locale])
	i18n.activate(locale)
}

/** Typed t() — message ids are compile-checked against the en catalog. */
export function t(id: MessageId, values?: Record<string, string | number>) {
	return i18n._(id, values)
}
