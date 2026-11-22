import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** cn() — shadcn's class merge helper; every ui component takes className. */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}
