import type {
  AttendanceRecord,
  ConsultationRecord,
  CustomerRecord,
  NoticeRecord,
  PerformanceRecord,
  ScheduleEvent,
  StaffUser
} from '@shared/commercial/models'
import { DEMO_USERS } from '@renderer/navigation/roleAccess'
import { backendConfig } from './backendConfig'

/**
 * Backend-ready commercial services using a repository/adapter pattern.
 *
 * Each service reads/writes through a Repository whose data source is chosen by
 * `backendConfig.mode`:
 *   - local-mock  → in-memory seeded data (current behavior, no server)
 *   - future-api  → prepared but DISABLED until configured (throws a clear error)
 *
 * This is the seam that lets the UI move from mock to a shared API + DB without
 * changing callers. No server is contacted in this sprint.
 *
 * Future: implement the `future-api` branch with fetch(apiBaseUrl + endpoint).
 */

export interface Repository<T extends { id: string }> {
  list: () => Promise<T[]>
  get: (id: string) => Promise<T | null>
  create: (item: T) => Promise<T>
  update: (id: string, patch: Partial<T>) => Promise<T | null>
}

function notConfigured(): never {
  throw new Error('서버 API가 아직 구성되지 않았습니다. 현재는 local-mock 모드입니다.')
}

function createRepository<T extends { id: string }>(seed: T[]): Repository<T> {
  let data = [...seed]
  const guard = (): void => {
    if (backendConfig.mode === 'supabase' && !backendConfig.isConfigured) notConfigured()
    // Future: when mode === 'supabase' && configured, route to the Supabase adapters.
  }
  return {
    async list() {
      guard()
      return [...data]
    },
    async get(id) {
      guard()
      return data.find((d) => d.id === id) ?? null
    },
    async create(item) {
      guard()
      data = [...data, item]
      return item
    },
    async update(id, patch) {
      guard()
      data = data.map((d) => (d.id === id ? { ...d, ...patch } : d))
      return data.find((d) => d.id === id) ?? null
    }
  }
}

// --- seed (local-mock) -----------------------------------------------------
// Business records start EMPTY so a real employee begins from a clean slate.
// Only the staff roster (derived from login accounts) is kept as scaffolding.

const staffSeed: StaffUser[] = DEMO_USERS.map((u) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  teamName: u.teamName,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}))

const customerSeed: CustomerRecord[] = []
const consultationSeed: ConsultationRecord[] = []
const scheduleSeed: ScheduleEvent[] = []
const attendanceSeed: AttendanceRecord[] = []
const performanceSeed: PerformanceRecord[] = []
const noticeSeed: NoticeRecord[] = []

// --- repositories + services ----------------------------------------------

export const staffRepository = createRepository(staffSeed)
export const customerRepository = createRepository(customerSeed)
export const consultationRepository = createRepository(consultationSeed)
export const scheduleRepository = createRepository(scheduleSeed)
export const attendanceRepository = createRepository(attendanceSeed)
export const performanceRepository = createRepository(performanceSeed)
export const noticeRepository = createRepository(noticeSeed)

/** Future: replace with server API (POST /auth/*). Local demo for now. */
export const authService = {
  me: async (): Promise<StaffUser | null> => (await staffRepository.list())[0] ?? null,
  listUsers: () => staffRepository.list()
}
export const staffService = staffRepository
export const attendanceService = attendanceRepository
export const customerService = customerRepository
export const consultationService = consultationRepository
export const scheduleService = scheduleRepository
export const performanceService = performanceRepository
export const noticeService = noticeRepository
