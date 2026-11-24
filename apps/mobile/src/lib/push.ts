import type { MobilePushPlatform, MobilePushTokenDto } from '@huriro/contracts'
import type { HuriroMobileApiClient } from './api-client'
import { type MobileDeepLinkTarget, parseHuriroDeepLink } from './deep-links'

export interface PushNotificationHintPayload {
	readonly notificationId?: unknown
	readonly entityType?: unknown
	readonly entityId?: unknown
	readonly deepLink?: unknown
}

/**
 * Resolves a push notification tap payload into a safe typed screen route.
 * Push notifications on Huriro intentionally carry hint identifiers only —
 * the app fetches details after verifying session + workspace context (§18.3).
 */
export function resolvePushHintTarget(
	data: PushNotificationHintPayload | null | undefined
): MobileDeepLinkTarget | null {
	if (!data || typeof data !== 'object') return null
	if (typeof data.deepLink === 'string') {
		const fromDeepLink = parseHuriroDeepLink(data.deepLink)
		if (fromDeepLink) return fromDeepLink
	}
	const entityType = typeof data.entityType === 'string' ? data.entityType : ''
	const entityId = typeof data.entityId === 'string' ? data.entityId : ''
	if (!entityId) return null

	if (entityType === 'issue') return parseHuriroDeepLink(`/issues/${entityId}`)
	if (entityType === 'chat_message' || entityType === 'chat_channel') {
		return parseHuriroDeepLink(`/chat/${entityId}`)
	}
	if (entityType === 'doc_page') return parseHuriroDeepLink(`/docs/${entityId}`)
	if (entityType === 'mail_conversation') return parseHuriroDeepLink(`/mail/${entityId}`)
	return null
}

export async function registerExpoPushDevice(args: {
	readonly api: HuriroMobileApiClient
	readonly platform: MobilePushPlatform
	readonly deviceId: string
	readonly deviceName: string
}): Promise<MobilePushTokenDto | null> {
	try {
		const Notifications = await import('expo-notifications')
		const existing = await Notifications.getPermissionsAsync()
		let status = existing.status
		if (status !== 'granted') {
			const req = await Notifications.requestPermissionsAsync()
			status = req.status
		}
		if (status !== 'granted') return null
		const pushToken = await Notifications.getExpoPushTokenAsync()
		if (!pushToken.data) return null
		return await args.api.registerMobilePushToken({
			token: pushToken.data,
			platform: args.platform,
			deviceId: args.deviceId,
			deviceName: args.deviceName
		})
	} catch {
		return null
	}
}
