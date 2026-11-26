import { type Static, Type } from 'typebox'

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const WeekdayKeySchema = Type.Union(WEEKDAY_KEYS.map((day) => Type.Literal(day)))

export const WorkingHoursIntervalSchema = Type.Object({
	start: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
	end: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
})
export type WorkingHoursInterval = Static<typeof WorkingHoursIntervalSchema>

export const WorkingHoursScheduleSchema = Type.Object({
	enabled: Type.Boolean(),
	timezone: Type.String({ minLength: 1, maxLength: 80 }),
	days: Type.Object({
		mon: Type.Array(WorkingHoursIntervalSchema, { maxItems: 4 }),
		tue: Type.Array(WorkingHoursIntervalSchema, { maxItems: 4 }),
		wed: Type.Array(WorkingHoursIntervalSchema, { maxItems: 4 }),
		thu: Type.Array(WorkingHoursIntervalSchema, { maxItems: 4 }),
		fri: Type.Array(WorkingHoursIntervalSchema, { maxItems: 4 }),
		sat: Type.Array(WorkingHoursIntervalSchema, { maxItems: 4 }),
		sun: Type.Array(WorkingHoursIntervalSchema, { maxItems: 4 })
	})
})
export type WorkingHoursSchedule = Static<typeof WorkingHoursScheduleSchema>

export const ManualAvailabilityStateSchema = Type.Union([
	Type.Literal('auto'),
	Type.Literal('available'),
	Type.Literal('busy'),
	Type.Literal('dnd'),
	Type.Literal('away'),
	Type.Literal('ooo')
])
export type ManualAvailabilityState = Static<typeof ManualAvailabilityStateSchema>

export const EffectiveAvailabilityStateSchema = Type.Union([
	Type.Literal('available'),
	Type.Literal('busy'),
	Type.Literal('dnd'),
	Type.Literal('away'),
	Type.Literal('off_hours'),
	Type.Literal('ooo'),
	Type.Literal('offline')
])
export type EffectiveAvailabilityState = Static<typeof EffectiveAvailabilityStateSchema>

export const AvailabilityWindowKindSchema = Type.Union([
	Type.Literal('ooo'),
	Type.Literal('focus'),
	Type.Literal('dnd')
])
export type AvailabilityWindowKind = Static<typeof AvailabilityWindowKindSchema>

export const AvailabilityWindowDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	kind: AvailabilityWindowKindSchema,
	title: Type.String(),
	message: Type.String(),
	startsAt: Type.String(),
	endsAt: Type.String(),
	delegateUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	autoDeclineRouting: Type.Boolean(),
	suppressNotifications: Type.Boolean(),
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type AvailabilityWindowDto = Static<typeof AvailabilityWindowDto>

export const CreateAvailabilityWindowBody = Type.Object({
	kind: Type.Optional(AvailabilityWindowKindSchema),
	title: Type.Optional(Type.String({ maxLength: 200 })),
	message: Type.Optional(Type.String({ maxLength: 2000 })),
	startsAt: Type.String(),
	endsAt: Type.String(),
	delegateUserId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	autoDeclineRouting: Type.Optional(Type.Boolean()),
	suppressNotifications: Type.Optional(Type.Boolean())
})
export type CreateAvailabilityWindowBody = Static<typeof CreateAvailabilityWindowBody>

export const UpdateAvailabilityWindowBody = Type.Object({
	kind: Type.Optional(AvailabilityWindowKindSchema),
	title: Type.Optional(Type.String({ maxLength: 200 })),
	message: Type.Optional(Type.String({ maxLength: 2000 })),
	startsAt: Type.Optional(Type.String()),
	endsAt: Type.Optional(Type.String()),
	delegateUserId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	autoDeclineRouting: Type.Optional(Type.Boolean()),
	suppressNotifications: Type.Optional(Type.Boolean()),
	version: Type.Optional(Type.Integer({ minimum: 1 }))
})
export type UpdateAvailabilityWindowBody = Static<typeof UpdateAvailabilityWindowBody>

export const UserAvailabilityDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	displayName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	handle: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	avatarUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	manualState: ManualAvailabilityStateSchema,
	manualStateExpiresAt: Type.Union([Type.String(), Type.Null()]),
	effectiveState: EffectiveAvailabilityStateSchema,
	statusEmoji: Type.Union([Type.String(), Type.Null()]),
	statusText: Type.String(),
	statusExpiresAt: Type.Union([Type.String(), Type.Null()]),
	dndUntil: Type.Union([Type.String(), Type.Null()]),
	workingHours: WorkingHoursScheduleSchema,
	timezone: Type.String(),
	suppressNotificationsOffHours: Type.Boolean(),
	allowUrgentOverride: Type.Boolean(),
	withinWorkingHours: Type.Boolean(),
	isRoutable: Type.Boolean(),
	isAcceptingNotifications: Type.Boolean(),
	nextAvailableAt: Type.Union([Type.String(), Type.Null()]),
	localTimeLabel: Type.Union([Type.String(), Type.Null()]),
	delegateUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	lastSeenAt: Type.Union([Type.String(), Type.Null()]),
	version: Type.Integer({ minimum: 1 }),
	windows: Type.Array(AvailabilityWindowDto),
	updatedAt: Type.Optional(Type.Union([Type.String(), Type.Null()]))
})
export type UserAvailabilityDto = Static<typeof UserAvailabilityDto>

export const UpdateMyAvailabilityBody = Type.Object({
	manualState: Type.Optional(ManualAvailabilityStateSchema),
	manualStateExpiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	statusEmoji: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
	statusText: Type.Optional(Type.String({ maxLength: 200 })),
	statusExpiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	dndUntil: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	workingHours: Type.Optional(WorkingHoursScheduleSchema),
	timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
	suppressNotificationsOffHours: Type.Optional(Type.Boolean()),
	allowUrgentOverride: Type.Optional(Type.Boolean()),
	expectedVersion: Type.Optional(Type.Integer({ minimum: 1 }))
})
export type UpdateMyAvailabilityBody = Static<typeof UpdateMyAvailabilityBody>

export const ListWorkspaceAvailabilityQuery = Type.Object({
	state: Type.Optional(EffectiveAvailabilityStateSchema),
	userId: Type.Optional(Type.String({ format: 'uuid' })),
	includeWindows: Type.Optional(Type.Boolean())
})
export type ListWorkspaceAvailabilityQuery = Static<typeof ListWorkspaceAvailabilityQuery>

export const ListWorkspaceAvailabilityResponse = Type.Object({
	data: Type.Array(UserAvailabilityDto),
	windows: Type.Optional(Type.Array(AvailabilityWindowDto))
})
export type ListWorkspaceAvailabilityResponse = Static<typeof ListWorkspaceAvailabilityResponse>

// ---------- Agent tool inputs ----------

export const AvailabilityListToolInput = Type.Object(
	{
		state: Type.Optional(EffectiveAvailabilityStateSchema),
		userIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 100 }))
	},
	{ additionalProperties: false }
)
export type AvailabilityListToolInput = Static<typeof AvailabilityListToolInput>

export const AvailabilityGetToolInput = Type.Object(
	{
		userId: Type.String({ format: 'uuid' })
	},
	{ additionalProperties: false }
)
export type AvailabilityGetToolInput = Static<typeof AvailabilityGetToolInput>

export const AvailabilitySetMyStatusToolInput = Type.Object(
	{
		manualState: Type.Optional(ManualAvailabilityStateSchema),
		statusEmoji: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
		statusText: Type.Optional(Type.String({ maxLength: 200 })),
		statusExpiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		dndUntil: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		expectedVersion: Type.Optional(Type.Integer({ minimum: 1 }))
	},
	{ additionalProperties: false }
)
export type AvailabilitySetMyStatusToolInput = Static<typeof AvailabilitySetMyStatusToolInput>

export const AvailabilityWindowParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})
export type AvailabilityWindowParam = Static<typeof AvailabilityWindowParam>

export const AvailabilityUserParam = Type.Object({
	userId: Type.String({ format: 'uuid' })
})
export type AvailabilityUserParam = Static<typeof AvailabilityUserParam>
