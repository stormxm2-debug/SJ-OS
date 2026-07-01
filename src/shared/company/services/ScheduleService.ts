import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { AppointmentRecord } from '../types'

export class ScheduleService {
  private readonly key: CompanyCollectionKey = 'appointments'

  get(id: string): AppointmentRecord | null {
    return companyRepository.get<AppointmentRecord>(this.key, id)
  }

  list(): AppointmentRecord[] {
    return companyRepository.list<AppointmentRecord>(this.key)
  }

  search(matcher: (item: AppointmentRecord) => boolean): AppointmentRecord[] {
    return companyRepository.search<AppointmentRecord>(this.key, matcher)
  }

  create(entity: AppointmentRecord) {
    return companyRepository.create<AppointmentRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<AppointmentRecord>) {
    return companyRepository.update<AppointmentRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const scheduleService = new ScheduleService()
