import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { ActivityRecord } from '../types'

export class ActivityService {
  private readonly key: CompanyCollectionKey = 'activity'

  get(id: string): ActivityRecord | null {
    return companyRepository.get<ActivityRecord>(this.key, id)
  }

  list(): ActivityRecord[] {
    return companyRepository.list<ActivityRecord>(this.key)
  }

  search(matcher: (item: ActivityRecord) => boolean): ActivityRecord[] {
    return companyRepository.search<ActivityRecord>(this.key, matcher)
  }

  create(entity: ActivityRecord) {
    return companyRepository.create<ActivityRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<ActivityRecord>) {
    return companyRepository.update<ActivityRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const activityService = new ActivityService()
