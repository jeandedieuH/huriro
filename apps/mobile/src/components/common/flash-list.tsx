import { type FlashListProps, type FlashListRef, FlashList as ShopifyFlashList } from '@shopify/flash-list'
import type { ReactElement, Ref } from 'react'
import { type ApplyUniwind, withUniwind } from 'uniwind'

/** FlashList props extended with Uniwind's `className`/`contentContainerClassName` mappings. */
export type ListProps<ItemT> = ApplyUniwind<FlashListProps<ItemT>>

// Uniwind only redirects `react-native` imports through Metro, so third-party
// components need an explicit `withUniwind` wrap for className props to resolve.
// The cast keeps the list generic over its item type (the HOC erases generics).
export const FlashList = withUniwind(ShopifyFlashList) as <ItemT>(
	props: ListProps<ItemT> & { readonly ref?: Ref<FlashListRef<ItemT>> }
) => ReactElement
