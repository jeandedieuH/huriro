import { Type } from 'typebox'

export {
	CreateGithubInstallationBody,
	CreateIssueGithubLinkBody,
	UpdateGithubInstallationBody
} from '@huriro/contracts'

export const InstallationIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const LinkIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const IssueIdParam = Type.Object({
	issueId: Type.String({ format: 'uuid' })
})
