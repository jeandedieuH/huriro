export interface ExpoConfigContext {
	readonly config?: Record<string, unknown>
}

export default function defineAppConfig({ config }: ExpoConfigContext = {}) {
	const rawApiUrl = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3001'
	let universalHost = 'app.huriro.dev'
	try {
		universalHost = new URL(rawApiUrl).hostname || universalHost
	} catch {
		// Fall back to canonical cloud host if unset/invalid during static config evaluation.
	}

	return {
		...config,
		name: 'Huriro',
		slug: 'huriro',
		version: '1.0.0',
		scheme: 'huriro',
		orientation: 'portrait',
		icon: './assets/images/icon.png',
		userInterfaceStyle: 'automatic',
		newArchEnabled: true,
		ios: {
			supportsTablet: true,
			bundleIdentifier: 'app.huriro.mobile',
			associatedDomains: [`applinks:${universalHost}`]
		},
		android: {
			package: 'app.huriro.mobile',
			intentFilters: [
				{
					action: 'VIEW',
					autoVerify: true,
					data: [
						{ scheme: 'https', host: universalHost, pathPrefix: '/issues' },
						{ scheme: 'https', host: universalHost, pathPrefix: '/chat' },
						{ scheme: 'https', host: universalHost, pathPrefix: '/docs' },
						{ scheme: 'https', host: universalHost, pathPrefix: '/mail' }
					],
					category: ['BROWSABLE', 'DEFAULT']
				}
			]
		},
		plugins: [
			'expo-router',
			'expo-sqlite',
			'expo-secure-store',
			'expo-notifications',
			[
				'expo-splash-screen',
				{
					image: './assets/images/splash.png',
					resizeMode: 'cover',
					backgroundColor: '#ffffff'
				}
			]
		],
		experiments: {
			typedRoutes: true
		},
		extra: {
			apiUrl: rawApiUrl,
			eas: {
				projectId: '80e7bbcc-280c-4ed2-9a84-ca4a1c8e88b1'
			}
		}
	}
}
