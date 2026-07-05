import { useEffect, useState } from 'react'
import type { PasswordResetRequest, StaffLoginAccount, StaffLoginStatus } from '@shared/commercial/phoneLogin'
import type { StaffRole } from '@shared/commercial/models'
import { normalizeKoreanPhoneNumber } from '@shared/phone'

/**
 * Admin-managed phone login registry (renderer, localStorage — the local/draft entry
 * gate). In production this mirrors the Supabase `staff_login_accounts` table
 * (see docs/supabase). Never logs phone numbers. Never stores passwords (passwords
 * live only in Supabase Auth via the server Edge Function).
 */

const ACCT_KEY = 'sj.phoneLogin.accounts'
const RESET_KEY = 'sj.phoneLogin.resets'
let accounts: StaffLoginAccount[] = load<StaffLoginAccount>(ACCT_KEY)
let resets: PasswordResetRequest[] = load<PasswordResetRequest>(RESET_KEY)
const listeners = new Set<() => void>()

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}
function persist(): void {
  try {
    localStorage.setItem(ACCT_KEY, JSON.stringify(accounts.slice(0, 1000)))
    localStorage.setItem(RESET_KEY, JSON.stringify(resets.slice(0, 1000)))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}
function nowIso(): string {
  return new Date().toISOString()
}
function rid(p: string): string {
  return `${p}-${accounts.length + resets.length}-${Math.floor(performance.now())}`
}

export function listStaffLoginAccounts(): StaffLoginAccount[] {
  return accounts
}
export function findByNormalizedPhone(normalized: string): StaffLoginAccount | null {
  return accounts.find((a) => a.normalizedPhone === normalized) ?? null
}

export interface AddAccountInput {
  name: string
  phone: string
  role: StaffRole
  teamName?: string
  createdBy?: string
}
export interface AddAccountResult {
  ok: boolean
  error?: string
}

export function addStaffLoginAccount(input: AddAccountInput): AddAccountResult {
  if (!input.name.trim()) return { ok: false, error: '이름을 입력해주세요.' }
  const norm = normalizeKoreanPhoneNumber(input.phone)
  if (!norm.ok || !norm.value) return { ok: false, error: norm.error ?? '휴대폰 번호 형식을 확인해주세요.' }
  if (findByNormalizedPhone(norm.value)) return { ok: false, error: '이미 등록된 휴대폰 번호입니다.' }
  const acc: StaffLoginAccount = {
    id: rid('acc'),
    name: input.name.trim(),
    phone: input.phone.trim(),
    normalizedPhone: norm.value,
    role: input.role,
    teamName: input.teamName?.trim() || undefined,
    status: 'invited',
    passwordStatus: 'not-set',
    createdBy: input.createdBy,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  accounts = [acc, ...accounts]
  persist()
  return { ok: true }
}

export function setAccountStatus(id: string, status: StaffLoginStatus): void {
  accounts = accounts.map((a) => (a.id === id ? { ...a, status, updatedAt: nowIso() } : a))
  persist()
}
export function setAccountRole(id: string, role: StaffRole): void {
  accounts = accounts.map((a) => (a.id === id ? { ...a, role, updatedAt: nowIso() } : a))
  persist()
}
export function setAccountTeam(id: string, teamId?: string, teamName?: string): void {
  accounts = accounts.map((a) => (a.id === id ? { ...a, teamId, teamName, updatedAt: nowIso() } : a))
  persist()
}

// --- password reset requests ----------------------------------------------

export function listResetRequests(): PasswordResetRequest[] {
  return resets
}
export function requestPasswordReset(normalizedPhone: string): void {
  // Only record if the phone is registered — but the caller shows a GENERIC message
  // regardless, to avoid account enumeration.
  const acc = findByNormalizedPhone(normalizedPhone)
  if (!acc) return
  resets = [{ id: rid('rst'), normalizedPhone, status: 'pending', requestedAt: nowIso() }, ...resets]
  accounts = accounts.map((a) => (a.id === acc.id ? { ...a, passwordStatus: 'reset-requested', updatedAt: nowIso() } : a))
  persist()
}
export function approveResetRequest(id: string, approvedBy?: string): void {
  const req = resets.find((r) => r.id === id)
  if (!req) return
  resets = resets.map((r) => (r.id === id ? { ...r, status: 'approved', approvedAt: nowIso(), approvedBy } : r))
  accounts = accounts.map((a) => (a.normalizedPhone === req.normalizedPhone ? { ...a, passwordStatus: 'reset-approved', updatedAt: nowIso() } : a))
  persist()
}

export function useStaffLoginAccounts(): { accounts: StaffLoginAccount[]; resets: PasswordResetRequest[] } {
  const [state, setState] = useState({ accounts, resets })
  useEffect(() => {
    const l = (): void => setState({ accounts: [...accounts], resets: [...resets] })
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}
