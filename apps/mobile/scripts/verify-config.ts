import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import defineAppConfig from '../app.config'

const root = resolve(import.meta.dirname, '..')
const cfg = defineAppConfig({})
if (cfg.scheme !== 'huriro' || cfg.ios.bundleIdentifier !== 'app.huriro.mobile') {
	throw new Error('Invalid Huriro Expo config metadata')
}

const eas = JSON.parse(readFileSync(resolve(root, 'eas.json'), 'utf8')) as {
	build?: Record<string, unknown>
}
for (const profile of ['development', 'preview', 'production']) {
	if (!eas.build?.[profile]) {
		throw new Error(`Missing EAS build profile: ${profile}`)
	}
}

console.log('apps/mobile configuration verified:', cfg.name, cfg.version)
