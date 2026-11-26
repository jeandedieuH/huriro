import {
	AiDocBlockAssistRequest,
	AiMailAssistRequest,
	AiProviderUpsert,
	AiSemanticSearchQuery,
	AiSettingsPatch,
	AiSummarizeRequest
} from '@huriro/contracts'
import { Type } from 'typebox'

export {
	AiDocBlockAssistRequest,
	AiMailAssistRequest,
	AiProviderUpsert,
	AiSemanticSearchQuery,
	AiSettingsPatch,
	AiSummarizeRequest
}

export const AiProviderIdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })
