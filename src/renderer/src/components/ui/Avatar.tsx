import type { WorkerRole } from '@shared/types'
import { ROLE_META } from '@renderer/lib/companyMeta'

interface AvatarProps {
  role: WorkerRole
  label: string
}

/**
 * Provider-neutral worker avatar: role-tinted tile with a role icon. The text
 * `label` (e.g. "DEV") is decorative initials, never a vendor identity.
 */
export default function Avatar({ role, label }: AvatarProps): JSX.Element {
  const { icon: Icon, avatarBg } = ROLE_META[role]
  return (
    <div
      className={[
        'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
        avatarBg
      ].join(' ')}
      title={label}
    >
      <Icon className="h-5 w-5" />
    </div>
  )
}
