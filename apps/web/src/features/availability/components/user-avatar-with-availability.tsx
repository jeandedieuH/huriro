import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useUserAvailability } from '../hooks/use-availability'
import { AvailabilityDot } from './availability-dot'
import { UserAvailabilityCard } from './user-availability-card'

export interface UserAvatarWithAvailabilityProps {
	readonly userId: string | null | undefined
	readonly name: string
	readonly avatarUrl?: string | null | undefined
	readonly size?: 'sm' | 'md' | 'lg'
	readonly showCard?: boolean
	readonly className?: string | undefined
}

const AVATAR_SIZE: Record<NonNullable<UserAvatarWithAvailabilityProps['size']>, string> = {
	sm: 'size-7',
	md: 'size-8',
	lg: 'size-10'
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2)
	return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

export function UserAvatarWithAvailability({
	userId,
	name,
	avatarUrl,
	size = 'md',
	showCard = true,
	className
}: UserAvatarWithAvailabilityProps) {
	const availability = useUserAvailability(userId)
	const avatar = (
		<span className={cn('relative inline-flex shrink-0', className)}>
			<Avatar className={AVATAR_SIZE[size]}>
				{avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
				<AvatarFallback>{initials(name)}</AvatarFallback>
			</Avatar>
			{availability ? (
				<AvailabilityDot
					state={availability.effectiveState}
					size={size === 'lg' ? 'md' : 'sm'}
					className="absolute -end-0.5 -bottom-0.5"
				/>
			) : null}
		</span>
	)
	if (!availability || !showCard || !userId) return avatar
	return <UserAvailabilityCard availability={availability}>{avatar}</UserAvailabilityCard>
}
