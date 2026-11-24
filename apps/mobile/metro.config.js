import { resolve } from 'node:path'
import { getDefaultConfig } from 'expo/metro-config'
import { withUniwindConfig } from 'uniwind/metro'

const projectRoot = import.meta.dirname
const monorepoRoot = resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
	resolve(projectRoot, 'node_modules'),
	resolve(monorepoRoot, 'node_modules')
]

export default withUniwindConfig(config, {
	cssEntryFile: './global.css',
	dtsFile: './src/uniwind-types.d.ts'
})
