import { useCallback, useEffect, useRef, useState } from 'react'
import { approvalService } from '@shared/company/services/ApprovalService'
import { activityService } from '@shared/company/services/ActivityService'
import { customerService } from '@shared/company/services/CustomerService'
import { notificationService } from '@shared/company/services/NotificationService'
import { salesService } from '@shared/company/services/SalesService'
import type { ApprovalRecord, ActivityRecord, CustomerRecord, NotificationRecord, SalesRecord } from '@shared/company/types'

export type ManagementWidgetStatus = 'loading' | 'success' | 'empty' | 'error'

export interface ManagementWidgetState<T> {
  status: ManagementWidgetStatus
  data: T
  error: string | null
  refreshedAt: string | null
}

export class CompanyManagementService {
  async loadApprovals(): Promise<ManagementWidgetState<ApprovalRecord[]>> {
    try {
      const approvals = approvalService.list()
      return { status: approvals.length === 0 ? 'empty' : 'success', data: approvals, error: null, refreshedAt: new Date().toISOString() }
    } catch (error) {
      return { status: 'error', data: [], error: error instanceof Error ? error.message : 'Unable to load approvals', refreshedAt: new Date().toISOString() }
    }
  }

  async loadActivityLog(): Promise<ManagementWidgetState<ActivityRecord[]>> {
    try {
      const items = activityService.list()
      return { status: items.length === 0 ? 'empty' : 'success', data: items, error: null, refreshedAt: new Date().toISOString() }
    } catch (error) {
      return { status: 'error', data: [], error: error instanceof Error ? error.message : 'Unable to load activity log', refreshedAt: new Date().toISOString() }
    }
  }

  async loadCustomers(): Promise<ManagementWidgetState<CustomerRecord[]>> {
    try {
      const customers = customerService.list()
      return { status: customers.length === 0 ? 'empty' : 'success', data: customers, error: null, refreshedAt: new Date().toISOString() }
    } catch (error) {
      return { status: 'error', data: [], error: error instanceof Error ? error.message : 'Unable to load customers', refreshedAt: new Date().toISOString() }
    }
  }

  async loadNotifications(): Promise<ManagementWidgetState<NotificationRecord[]>> {
    try {
      const items = notificationService.list()
      return { status: items.length === 0 ? 'empty' : 'success', data: items, error: null, refreshedAt: new Date().toISOString() }
    } catch (error) {
      return { status: 'error', data: [], error: error instanceof Error ? error.message : 'Unable to load notifications', refreshedAt: new Date().toISOString() }
    }
  }

  async loadSales(): Promise<ManagementWidgetState<SalesRecord[]>> {
    try {
      const sales = salesService.list()
      return { status: sales.length === 0 ? 'empty' : 'success', data: sales, error: null, refreshedAt: new Date().toISOString() }
    } catch (error) {
      return { status: 'error', data: [], error: error instanceof Error ? error.message : 'Unable to load sales', refreshedAt: new Date().toISOString() }
    }
  }
}

export const companyManagementService = new CompanyManagementService()

export function useCompanyManagementWidget<T>(loader: () => Promise<ManagementWidgetState<T>>, refreshKey = 0): ManagementWidgetState<T> & { refresh: () => Promise<void> } {
  const [state, setState] = useState<ManagementWidgetState<T>>({
    status: 'loading',
    data: [] as unknown as T,
    error: null,
    refreshedAt: null
  })

  // Stable refresh via a loader ref — depending on the inline `loader` directly
  // recreated `refresh` every render, re-running the load effect every render
  // (an infinite load/setState/render loop that froze the app).
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    const next = await loaderRef.current()
    setState(next)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  return { ...state, refresh }
}
