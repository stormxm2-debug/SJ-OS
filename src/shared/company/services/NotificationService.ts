import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { NotificationRecord } from '../types'

export class NotificationService {
  private readonly key: CompanyCollectionKey = 'notifications'

  get(id: string): NotificationRecord | null {
    return companyRepository.get<NotificationRecord>(this.key, id)
  }

  list(): NotificationRecord[] {
    return companyRepository.list<NotificationRecord>(this.key)
  }

  search(matcher: (item: NotificationRecord) => boolean): NotificationRecord[] {
    return companyRepository.search<NotificationRecord>(this.key, matcher)
  }

  create(entity: NotificationRecord) {
    return companyRepository.create<NotificationRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<NotificationRecord>) {
    return companyRepository.update<NotificationRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const notificationService = new NotificationService()
