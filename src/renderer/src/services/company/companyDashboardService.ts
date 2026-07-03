import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { companyRepository } from '@shared/company/CompanyRepository'
import { customerService } from '@shared/company/services/CustomerService'
import { fcService } from '@shared/company/services/FCService'
import { notificationService } from '@shared/company/services/NotificationService'
import { salesService } from '@shared/company/services/SalesService'
import { scheduleService } from '@shared/company/services/ScheduleService'
import { taskService } from '@shared/company/services/TaskService'
import type {
  ActivityRecord,
  AppointmentRecord,
  CustomerRecord,
  FcRecord,
  NotificationRecord,
  SalesRecord,
  TaskRecord
} from '@shared/company/types'

export type DashboardWidgetStatus = 'loading' | 'success' | 'empty' | 'error'

export interface DashboardWidgetState<T> {
  status: DashboardWidgetStatus
  data: T
  error: string | null
  refreshedAt: string | null
}

interface DashboardServiceCacheEntry<T> {
  value: T
  expiresAt: number
}

const CACHE_TTL_MS = 30_000

class DashboardServiceCache {
  private store = new Map<string, DashboardServiceCacheEntry<unknown>>()

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return entry.value as T
  }

  clear(): void {
    this.store.clear()
  }
}

const cache = new DashboardServiceCache()

function formatCurrency(amount: number): string {
  return `₩${amount.toLocaleString('ko-KR')}`
}

async function loadWithCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = cache.get<T>(key)
  if (cached) {
    return cached
  }

  const value = await loader()
  cache.set(key, value)
  return value
}

export class CompanyDashboardService {
  private readonly repository = companyRepository

  async loadSalesToday(): Promise<DashboardWidgetState<SalesRecord[]>> {
    return this.loadListState('sales-today', async () => salesService.list(), (items) => items.length === 0)
  }

  async loadPremiumToday(): Promise<DashboardWidgetState<number>> {
    const sales = await loadWithCache('sales-premium', async () => salesService.list())
    const total = sales.reduce((sum, item) => sum + item.amount, 0)
    return {
      status: 'success',
      data: total,
      error: null,
      refreshedAt: new Date().toISOString()
    }
  }

  async loadFcAttendance(): Promise<DashboardWidgetState<FcRecord[]>> {
    return this.loadListState('fc-attendance', async () => fcService.list(), (items) => items.length === 0)
  }

  async loadFcOnline(): Promise<DashboardWidgetState<FcRecord[]>> {
    return this.loadListState('fc-online', async () => fcService.search((item) => item.status === 'active'), (items) => items.length === 0)
  }

  async loadPendingTasks(): Promise<DashboardWidgetState<TaskRecord[]>> {
    return this.loadListState('pending-tasks', async () => taskService.search((item) => item.status === 'pending' || item.status === 'in_progress'), (items) => items.length === 0)
  }

  async loadUnreadNotifications(): Promise<DashboardWidgetState<NotificationRecord[]>> {
    return this.loadListState('unread-notifications', async () => notificationService.search((item) => item.unread), (items) => items.length === 0)
  }

  async loadTodaySchedule(): Promise<DashboardWidgetState<AppointmentRecord[]>> {
    return this.loadListState('today-schedule', async () => scheduleService.list(), (items) => items.length === 0)
  }

  async loadRecentContracts(): Promise<DashboardWidgetState<SalesRecord[]>> {
    return this.loadListState('recent-contracts', async () => salesService.list(), (items) => items.length === 0)
  }

  async loadRecentCustomers(): Promise<DashboardWidgetState<CustomerRecord[]>> {
    return this.loadListState('recent-customers', async () => customerService.list(), (items) => items.length === 0)
  }

  async loadActivityFeed(): Promise<DashboardWidgetState<ActivityRecord[]>> {
    return this.loadListState('activity-feed', async () => this.repository.list<ActivityRecord>('activity'), (items) => items.length === 0)
  }

  async loadSummary(): Promise<DashboardWidgetState<{
    salesToday: string
    premiumToday: string
    onlineFc: number
    pendingTasks: number
    unreadNotifications: number
    appointments: number
  }>> {
    const [sales, premium, fcOnline, pendingTasks, notifications] = await Promise.all([
      this.loadSalesToday(),
      this.loadPremiumToday(),
      this.loadFcOnline(),
      this.loadPendingTasks(),
      this.loadUnreadNotifications()
    ])

    return {
      status: 'success',
      data: {
        salesToday: formatCurrency(sales.data.reduce((sum, item) => sum + item.amount, 0)),
        premiumToday: formatCurrency(premium.data),
        onlineFc: fcOnline.data.length,
        pendingTasks: pendingTasks.data.length,
        unreadNotifications: notifications.data.length,
        appointments: (await scheduleService.list()).length
      },
      error: null,
      refreshedAt: new Date().toISOString()
    }
  }

  async refreshAll(): Promise<void> {
    cache.clear()
    await Promise.all([
      this.loadSalesToday(),
      this.loadPremiumToday(),
      this.loadFcAttendance(),
      this.loadFcOnline(),
      this.loadPendingTasks(),
      this.loadUnreadNotifications(),
      this.loadTodaySchedule(),
      this.loadRecentContracts(),
      this.loadRecentCustomers(),
      this.loadActivityFeed(),
      this.loadSummary()
    ])
  }

  private async loadListState<T>(
    key: string,
    loader: () => Promise<T[]>,
    isEmpty: (items: T[]) => boolean
  ): Promise<DashboardWidgetState<T[]>> {
    try {
      const data = await loadWithCache(key, async () => loader())
      return {
        status: isEmpty(data) ? 'empty' : 'success',
        data,
        error: null,
        refreshedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Unable to load data',
        refreshedAt: new Date().toISOString()
      }
    }
  }
}

export const companyDashboardService = new CompanyDashboardService()

export function useCompanyDashboardWidget<T>(loader: () => Promise<DashboardWidgetState<T>>, refreshKey = 0): DashboardWidgetState<T> & { refresh: () => Promise<void> } {
  const [state, setState] = useState<DashboardWidgetState<T>>({
    status: 'loading',
    data: [] as unknown as T,
    error: null,
    refreshedAt: null
  })

  // Keep the latest loader in a ref so `refresh` can be STABLE. Consumers pass an
  // inline arrow (a new function every render); depending on it directly made
  // `refresh` change every render, which re-ran the effects below on every
  // render → an infinite load/setState/render loop (×N widgets) that froze the
  // app once the dashboard mounted. The ref breaks that loop.
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    const next = await loaderRef.current()
    setState(next)
  }, [])

  // Initial load, and reload when the caller bumps refreshKey.
  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  // Periodic auto-refresh — a single interval, set once (refresh is stable).
  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh()
    }, 30_000)

    return () => window.clearInterval(interval)
  }, [refresh])

  return { ...state, refresh }
}
