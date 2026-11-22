import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(ts|tsx)'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
	framework: '@storybook/react-vite',
	viteFinal: async (config) => {
		// Drop the app-server plugins the project's vite.config carries —
		// tanstackStart/router plugins expect a single client entry + route files,
		// nitro builds the SSR server; none of them belong in the Storybook bundle.
		const plugins = (config.plugins ?? [])
			.flat(9)
			.filter(
				(p) =>
					!['tanstack', 'nitro'].some(
						(prefix) => typeof p === 'object' && p !== null && 'name' in p && p.name.startsWith(prefix)
					)
			)
		return { ...config, plugins }
	}
}
export default config
