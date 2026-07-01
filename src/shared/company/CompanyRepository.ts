import { CompanyEvents, type CompanyEventName } from './CompanyEvents'
import { CompanyState } from './CompanyState'
import type {
  ActivityRecord,
  ApprovalRecord,
  AppointmentRecord,
  CompanySnapshot,
  CustomerRecord,
  FcRecord,
  KpiRecord,
  NotificationRecord,
  PolicyRecord,
  SalesRecord,
  TaskRecord
} from './types'

export type CompanyCollectionKey = keyof CompanySnapshot

export type CompanyEntity =
  | FcRecord
  | CustomerRecord
  | PolicyRecord
  | SalesRecord
  | AppointmentRecord
  | TaskRecord
  | NotificationRecord
  | ActivityRecord
  | ApprovalRecord
  | KpiRecord

export interface RepositoryOperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

export class CompanyRepository {
  constructor(
    private readonly state = new CompanyState(),
    private readonly events = new CompanyEvents()
  ) {}

  getSnapshot(): CompanySnapshot {
    return this.state.getSnapshot()
  }

  subscribe(listener: (event: { type: CompanyEventName; payload?: unknown; timestamp: string }) => void): () => void {
    return this.events.subscribe(listener)
  }

  private emit(type: CompanyEventName, payload?: unknown): void {
    this.events.emit(type, payload)
  }

  get<T extends CompanyEntity>(key: CompanyCollectionKey, id: string): T | null {
    const collection = this.getCollection(key)
    return (collection.find((item) => (item as { id: string }).id === id) as T | undefined) ?? null
  }

  list<T extends CompanyEntity>(key: CompanyCollectionKey): T[] {
    return this.getCollection(key) as T[]
  }

  search<T extends CompanyEntity>(key: CompanyCollectionKey, matcher: (item: T) => boolean): T[] {
    return this.list<T>(key).filter(matcher)
  }

  create<T extends CompanyEntity>(key: CompanyCollectionKey, entity: T): RepositoryOperationResult<T> {
    const collection = this.getCollection(key)
    const next = [...collection, entity] as CompanyEntity[]
    this.setCollection(key, next)
    this.emit(`${key}:updated` as CompanyEventName)
    return { success: true, data: entity }
  }

  update<T extends CompanyEntity>(key: CompanyCollectionKey, id: string, updates: Partial<T>): RepositoryOperationResult<T> {
    const collection = this.getCollection(key)
    const index = collection.findIndex((item) => (item as { id: string }).id === id)
    if (index === -1) {
      return { success: false, error: 'entity not found' }
    }

    const current = collection[index] as T
    const nextEntity = { ...current, ...updates } as T
    const nextCollection = [...collection]
    nextCollection[index] = nextEntity
    this.setCollection(key, nextCollection)
    this.emit(`${key}:updated` as CompanyEventName)
    return { success: true, data: nextEntity }
  }

  delete(key: CompanyCollectionKey, id: string): RepositoryOperationResult<void> {
    const collection = this.getCollection(key)
    const nextCollection = collection.filter((item) => (item as { id: string }).id !== id)
    if (nextCollection.length === collection.length) {
      return { success: false, error: 'entity not found' }
    }

    this.setCollection(key, nextCollection)
    this.emit(`${key}:updated` as CompanyEventName)
    return { success: true }
  }

  private getCollection(key: CompanyCollectionKey): CompanyEntity[] {
    const snapshot = this.state.getSnapshot()
    switch (key) {
      case 'fc':
        return snapshot.fc
      case 'customers':
        return snapshot.customers
      case 'policies':
        return snapshot.policies
      case 'sales':
        return snapshot.sales
      case 'appointments':
        return snapshot.appointments
      case 'tasks':
        return snapshot.tasks
      case 'notifications':
        return snapshot.notifications
      case 'activity':
        return snapshot.activity
      case 'approvals':
        return snapshot.approvals
      case 'kpis':
        return snapshot.kpis
      default:
        return []
    }
  }

  private setCollection(key: CompanyCollectionKey, value: CompanyEntity[]): void {
    const snapshot = this.state.getSnapshot()
    const nextSnapshot = { ...snapshot }
    switch (key) {
      case 'fc':
        nextSnapshot.fc = value as FcRecord[]
        break
      case 'customers':
        nextSnapshot.customers = value as CustomerRecord[]
        break
      case 'policies':
        nextSnapshot.policies = value as PolicyRecord[]
        break
      case 'sales':
        nextSnapshot.sales = value as SalesRecord[]
        break
      case 'appointments':
        nextSnapshot.appointments = value as AppointmentRecord[]
        break
      case 'tasks':
        nextSnapshot.tasks = value as TaskRecord[]
        break
      case 'notifications':
        nextSnapshot.notifications = value as NotificationRecord[]
        break
      case 'activity':
        nextSnapshot.activity = value as ActivityRecord[]
        break
      case 'approvals':
        nextSnapshot.approvals = value as ApprovalRecord[]
        break
      case 'kpis':
        nextSnapshot.kpis = value as KpiRecord[]
        break
    }

    this.state.setSnapshot(nextSnapshot)
  }
}

export const companyRepository = new CompanyRepository()
