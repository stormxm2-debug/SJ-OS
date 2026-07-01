import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { TaskRecord } from '../types'

export class TaskService {
  private readonly key: CompanyCollectionKey = 'tasks'

  get(id: string): TaskRecord | null {
    return companyRepository.get<TaskRecord>(this.key, id)
  }

  list(): TaskRecord[] {
    return companyRepository.list<TaskRecord>(this.key)
  }

  search(matcher: (item: TaskRecord) => boolean): TaskRecord[] {
    return companyRepository.search<TaskRecord>(this.key, matcher)
  }

  create(entity: TaskRecord) {
    return companyRepository.create<TaskRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<TaskRecord>) {
    return companyRepository.update<TaskRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const taskService = new TaskService()
