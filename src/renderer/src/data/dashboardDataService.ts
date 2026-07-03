import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mockCompanyData, type DashboardMockSnapshot } from './mockDashboardData'
import type { ActivityEvent, Notification, Worker } from '@shared/types'

export type DashboardWidgetStatus = 'loading' | 'success' | 'error'

export interface DashboardMetricState {
  status: DashboardWidgetStatus
  value: string
  hint: string
  error: string | null
  isFallback: boolean
}

export interface DashboardNotificationsState {
  status: DashboardWidgetStatus
  items: Notification[]
  error: string | null
  isFallback: boolean
}

export interface DashboardActivityState {
  status: DashboardWidgetStatus
  items: ActivityEvent[]
  error: string | null
  isFallback: boolean
}

interface DashboardApiResponse<T> {
  data: T
}

interface DashboardProvider {
  loadEmployeesOnline(): Promise<DashboardMetricState>
  loadAppointments(): Promise<DashboardMetricState>
  loadSales(): Promise<DashboardMetricState>
  loadPendingTasks(): Promise<DashboardMetricState>
  loadNotifications(): Promise<DashboardNotificationsState>
  loadRecentActivity(): Promise<DashboardActivityState>
}

class LiveDashboardProvider implements DashboardProvider {
  private readonly baseUrl: string

  constructor(baseUrl = '/api/dashboard') {
    this.baseUrl = baseUrl
  }

  async loadEmployeesOnline(): Promise<DashboardMetricState> {
    const data = await this.get<DashboardMetricState>(`${this.baseUrl}/employees-online`)
    return data
  }

  async loadAppointments(): Promise<DashboardMetricState> {
    const data = await this.get<DashboardMetricState>(`${this.baseUrl}/appointments`)
    return data
  }

  async loadSales(): Promise<DashboardMetricState> {
    const data = await this.get<DashboardMetricState>(`${this.baseUrl}/sales`)
    return data
  }

  async loadPendingTasks(): Promise<DashboardMetricState> {
    const data = await this.get<DashboardMetricState>(`${this.baseUrl}/pending-tasks`)
    return data
  }

  async loadNotifications(): Promise<DashboardNotificationsState> {
    const data = await this.get<DashboardNotificationsState>(`${this.baseUrl}/notifications`)
    return data
  }

  async loadRecentActivity(): Promise<DashboardActivityState> {
    const data = await this.get<DashboardActivityState>(`${this.baseUrl}/activity`)
    return data
  }

  private async get<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Request failed with ${response.status}`)
    const payload = (await response.json()) as DashboardApiResponse<T> | T
    return (payload as DashboardApiResponse<T>).data ?? (payload as T)
  }
}

class MockDashboardProvider implements DashboardProvider {
  loadEmployeesOnline(): Promise<DashboardMetricState> {
    return Promise.resolve(mockCompanyData.employeesOnline)
  }

  loadAppointments(): Promise<DashboardMetricState> {
    return Promise.resolve(mockCompanyData.appointments)
  }

  loadSales(): Promise<DashboardMetricState> {
    return Promise.resolve(mockCompanyData.sales)
  }

  loadPendingTasks(): Promise<DashboardMetricState> {
    return Promise.resolve(mockCompanyData.pendingTasks)
  }

  loadNotifications(): Promise<DashboardNotificationsState> {
    return Promise.resolve(mockCompanyData.notifications)
  }

  loadRecentActivity(): Promise<DashboardActivityState> {
    return Promise.resolve(mockCompanyData.activity)
  }
}

export class DashboardDataService {
  private readonly liveProvider: DashboardProvider
  private readonly mockProvider: DashboardProvider

  constructor(liveProvider?: DashboardProvider, mockProvider?: DashboardProvider) {
    this.liveProvider = liveProvider ?? new LiveDashboardProvider()
    this.mockProvider = mockProvider ?? new MockDashboardProvider()
  }

  async loadEmployeesOnline(): Promise<DashboardMetricState> {
    return this.loadWithFallback(() => this.liveProvider.loadEmployeesOnline(), () => this.mockProvider.loadEmployeesOnline())
  }

  async loadAppointments(): Promise<DashboardMetricState> {
    return this.loadWithFallback(() => this.liveProvider.loadAppointments(), () => this.mockProvider.loadAppointments())
  }

  async loadSales(): Promise<DashboardMetricState> {
    return this.loadWithFallback(() => this.liveProvider.loadSales(), () => this.mockProvider.loadSales())
  }

  async loadPendingTasks(): Promise<DashboardMetricState> {
    return this.loadWithFallback(() => this.liveProvider.loadPendingTasks(), () => this.mockProvider.loadPendingTasks())
  }

  async loadNotifications(): Promise<DashboardNotificationsState> {
    return this.loadWithFallback(() => this.liveProvider.loadNotifications(), () => this.mockProvider.loadNotifications())
  }

  async loadRecentActivity(): Promise<DashboardActivityState> {
    return this.loadWithFallback(() => this.liveProvider.loadRecentActivity(), () => this.mockProvider.loadRecentActivity())
  }

  private async loadWithFallback<T extends { status: DashboardWidgetStatus; error: string | null; isFallback: boolean }>(
    liveLoader: () => Promise<T>,
    mockLoader: () => Promise<T>
  ): Promise<T> {
    try {
      const data = await liveLoader()
      if (data.status === 'error') {
        return this.withFallback(data, await mockLoader())
      }
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load live data.'
      const fallback = await mockLoader()
      return this.withFallback({ ...fallback, error: message } as T, fallback)
    }
  }

  private withFallback<T extends { isFallback: boolean }>(value: T, fallback: T): T {
    return { ...fallback, ...value, isFallback: true } as T
  }
}

export const dashboardDataService = new DashboardDataService()

export function useDashboardMetric(loader: () => Promise<DashboardMetricState>, refreshKey = 0): DashboardMetricState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<DashboardMetricState>({
    status: 'loading',
    value: '—',
    hint: 'Loading…',
    error: null,
    isFallback: false
  })

  // Stable refresh via a loader ref — depending on the inline `loader` directly
  // recreated `refresh` every render, re-running the load effect every render
  // (an infinite load/setState/render loop that froze the app).
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    const data = await loaderRef.current()
    setState(data)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  return { ...state, refresh }
}

export function useDashboardNotifications(loader: () => Promise<DashboardNotificationsState>, refreshKey = 0): DashboardNotificationsState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<DashboardNotificationsState>({
    status: 'loading',
    items: [],
    error: null,
    isFallback: false
  })

  // Stable refresh via a loader ref — depending on the inline `loader` directly
  // recreated `refresh` every render, re-running the load effect every render
  // (an infinite load/setState/render loop that froze the app).
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    const data = await loaderRef.current()
    setState(data)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  return { ...state, refresh }
}

export function useDashboardActivity(loader: () => Promise<DashboardActivityState>, refreshKey = 0): DashboardActivityState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<DashboardActivityState>({
    status: 'loading',
    items: [],
    error: null,
    isFallback: false
  })

  // Stable refresh via a loader ref — depending on the inline `loader` directly
  // recreated `refresh` every render, re-running the load effect every render
  // (an infinite load/setState/render loop that froze the app).
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    const data = await loaderRef.current()
    setState(data)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  return { ...state, refresh }
}
