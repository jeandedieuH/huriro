/** @param {{ cache: (value: boolean) => void }} api */
export default function babelConfig(api) {
	api.cache(true)
	return {
		presets: ['babel-preset-expo']
	}
}
