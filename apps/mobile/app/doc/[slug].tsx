import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Card, Chip } from 'heroui-native'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { DocDomEditor } from '../../src/components/docs/doc-dom-editor'
import { useMobileRuntime } from '../../src/lib/runtime-context'

export default function DocDetailScreen() {
	const params = useLocalSearchParams<{ slug?: string }>()
	const slug = typeof params['slug'] === 'string' ? params['slug'] : ''
	const { runtime } = useMobileRuntime()
	const engine = useSyncEngine()
	const pages = useCollectionItems(engine.collections.docPages)
	const summary = pages.find((p) => p.slug === slug || p.id === slug)
	const [markdown, setMarkdown] = useState('# Engineering Handbook\n\nSynced offline-first via SQLite.')

	useEffect(() => {
		if (!runtime || runtime.isPreview || !slug) return
		let cancelled = false
		void runtime.api
			.getDocBySlug(slug)
			.then((detail) => {
				if (!cancelled && detail.plainText) setMarkdown(detail.plainText)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [runtime, slug])

	return (
		<>
			<Stack.Screen options={{ headerShown: true, title: summary?.title ?? t('mobile.docs.title') }} />
			<Container gap={12}>
				<Card className="p-4 rounded-2xl border border-border/60 gap-2">
					<View className="flex-row items-center justify-between">
						<Card.Title className="text-lg font-bold flex-1">{summary?.title ?? slug}</Card.Title>
						<Chip size="sm" variant="soft" color="accent">
							<Chip.Label>Light Editor</Chip.Label>
						</Chip>
					</View>
					<Card.Description className="text-xs font-mono">/{slug}</Card.Description>
				</Card>

				<Card className="rounded-2xl border border-border/60 overflow-hidden p-1">
					<DocDomEditor
						dom={{ matchContents: true }}
						docId={summary?.id ?? slug}
						initialMarkdown={markdown}
						onSaveMarkdown={async (nextMd) => {
							setMarkdown(nextMd)
							if (summary) {
								await engine.updateDocPage(summary.id, { title: summary.title })
							}
						}}
					/>
				</Card>
			</Container>
		</>
	)
}
