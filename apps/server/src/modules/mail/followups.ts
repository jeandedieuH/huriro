/** Mail follow-up wakeups (M11 §6.2): pg-boss sweeps due rows; `if_no_reply`
 * completes silently when the customer replied after the reminder was set,
 * otherwise the conversation reopens and the assignee is notified.
 */
import { type Sql, withWorkspace } from '@huriro/db'

export async function runMailFollowupsOnce(sql: Sql): Promise<number> {
	const due = await sql<
		{ workspaceId: string; id: string }[]
	>`SELECT workspace_id AS "workspaceId", id FROM list_mail_followups_due()`
	let woken = 0
	for (const item of due) {
		woken += await withWorkspace(sql, { workspaceId: item.workspaceId }, async (tx) => {
			const [conv] = await tx<
				{
					id: string
					status: string
					assigneeId: string | null
					subject: string
					followUpAt: string
					condition: 'if_no_reply' | 'always' | null
				}[]
			>`
				SELECT id, status, assignee_id AS "assigneeId", subject,
					follow_up_at::text AS "followUpAt", follow_up_condition AS condition
				FROM mail_conversations
				WHERE workspace_id = ${item.workspaceId} AND id = ${item.id}
					AND follow_up_at IS NOT NULL AND follow_up_completed_at IS NULL
					AND follow_up_at <= now()
				FOR UPDATE
			`
			if (!conv) return 0
			const [latestInbound] = await tx<{ receivedAt: string }[]>`
				SELECT received_at::text AS "receivedAt"
				FROM mail_messages
				WHERE workspace_id = ${item.workspaceId}
					AND conversation_id = ${item.id}
					AND direction = 'inbound'
				ORDER BY received_at DESC LIMIT 1
			`
			const replied =
				latestInbound && new Date(latestInbound.receivedAt).getTime() > new Date(conv.followUpAt).getTime()
			if (conv.condition !== 'always' && replied) {
				await tx`
					UPDATE mail_conversations
					SET follow_up_completed_at = now(), version = version + 1
					WHERE workspace_id = ${item.workspaceId} AND id = ${item.id}
				`
				return 0
			}
			await tx`
				UPDATE mail_conversations
				SET status = 'open', follow_up_completed_at = now(), version = version + 1
				WHERE workspace_id = ${item.workspaceId} AND id = ${item.id}
			`
			await tx`
				INSERT INTO mail_conversation_events (workspace_id, conversation_id, kind, actor_id, payload)
				VALUES (${item.workspaceId}, ${item.id}, 'follow_up_due', NULL, '{}'::jsonb)
			`
			if (conv.assigneeId) {
				await tx`
					INSERT INTO notifications (workspace_id, recipient_user_id, actor_type, actor_id, kind, entity_type, entity_id, title, body, metadata)
					VALUES (${item.workspaceId}, ${conv.assigneeId}, 'system', NULL, 'mail.follow_up_due',
						'mail_conversation', ${item.id}, 'Mail follow-up due', ${conv.subject}, '{}'::jsonb)
				`
			}
			return 1
		})
	}
	return woken
}
