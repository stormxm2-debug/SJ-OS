import {
  Compass,
  Code2,
  ShieldCheck,
  GitBranch,
  FileText,
  Rocket,
  Crown,
  Cpu,
  Search,
  MonitorSmartphone,
  Server,
  type LucideIcon
} from 'lucide-react'
import type {
  WorkerRole,
  WorkerStatus,
  TaskState,
  ProjectStatus,
  ActivityActor
} from '@shared/types'

/** Presentation metadata for roles/statuses. Pure UI mapping — no vendor names. */

export const ROLE_LABEL: Record<WorkerRole, string> = {
  cto: 'CTO Agent',
  research: 'Research Engineer',
  frontend: 'Frontend Engineer',
  backend: 'Backend Engineer',
  developer: 'Developer',
  qa: 'QA Engineer',
  git: 'Git Manager',
  documentation: 'Documentation Manager',
  release: 'Release Manager'
}

export const ROLE_META: Record<
  WorkerRole,
  { icon: LucideIcon; avatarBg: string }
> = {
  cto: { icon: Compass, avatarBg: 'bg-indigo-500/20 text-indigo-300' },
  research: { icon: Search, avatarBg: 'bg-cyan-500/20 text-cyan-300' },
  frontend: { icon: MonitorSmartphone, avatarBg: 'bg-fuchsia-500/20 text-fuchsia-300' },
  backend: { icon: Server, avatarBg: 'bg-teal-500/20 text-teal-300' },
  developer: { icon: Code2, avatarBg: 'bg-violet-500/20 text-violet-300' },
  qa: { icon: ShieldCheck, avatarBg: 'bg-emerald-500/20 text-emerald-300' },
  git: { icon: GitBranch, avatarBg: 'bg-orange-500/20 text-orange-300' },
  documentation: { icon: FileText, avatarBg: 'bg-sky-500/20 text-sky-300' },
  release: { icon: Rocket, avatarBg: 'bg-rose-500/20 text-rose-300' }
}

export const STATUS_META: Record<
  WorkerStatus,
  { label: string; dot: string; text: string; chip: string }
> = {
  working: {
    label: 'Working',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    chip: 'bg-emerald-500/10 border-emerald-500/20'
  },
  review: {
    label: 'In Review',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    chip: 'bg-amber-500/10 border-amber-500/20'
  },
  blocked: {
    label: 'Blocked',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    chip: 'bg-rose-500/10 border-rose-500/20'
  },
  idle: {
    label: 'Idle',
    dot: 'bg-slate-400',
    text: 'text-slate-300',
    chip: 'bg-slate-500/10 border-slate-500/20'
  },
  offline: {
    label: 'Offline',
    dot: 'bg-zinc-500',
    text: 'text-zinc-400',
    chip: 'bg-zinc-500/10 border-zinc-500/20'
  }
}

export const TASK_STATE_META: Record<TaskState, { label: string; text: string }> =
  {
    pending: { label: 'Pending', text: 'text-slate-400' },
    in_progress: { label: 'In Progress', text: 'text-emerald-300' },
    awaiting_approval: { label: 'Awaiting Approval', text: 'text-amber-300' },
    done: { label: 'Done', text: 'text-sky-300' },
    failed: { label: 'Failed', text: 'text-rose-300' }
  }

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  { label: string; text: string; dot: string }
> = {
  planning: { label: 'Planning', text: 'text-slate-300', dot: 'bg-slate-400' },
  building: { label: 'Building', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  review: { label: 'In Review', text: 'text-amber-300', dot: 'bg-amber-400' },
  released: { label: 'Released', text: 'text-sky-300', dot: 'bg-sky-400' },
  paused: { label: 'Paused', text: 'text-zinc-400', dot: 'bg-zinc-500' }
}

/** Activity-actor presentation (workers + CEO + system). */
export function actorLabel(actor: ActivityActor): string {
  if (actor === 'ceo') return 'CEO'
  if (actor === 'system') return 'System'
  return ROLE_LABEL[actor]
}

export function actorIcon(actor: ActivityActor): LucideIcon {
  if (actor === 'ceo') return Crown
  if (actor === 'system') return Cpu
  return ROLE_META[actor].icon
}
