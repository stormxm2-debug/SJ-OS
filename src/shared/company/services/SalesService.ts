import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { SalesRecord } from '../types'

export class SalesService {
  private readonly key: CompanyCollectionKey = 'sales'

  get(id: string): SalesRecord | null {
    return companyRepository.get<SalesRecord>(this.key, id)
  }

  list(): SalesRecord[] {
    return companyRepository.list<SalesRecord>(this.key)
  }

  search(matcher: (item: SalesRecord) => boolean): SalesRecord[] {
    return companyRepository.search<SalesRecord>(this.key, matcher)
  }

  create(entity: SalesRecord) {
    return companyRepository.create<SalesRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<SalesRecord>) {
    return companyRepository.update<SalesRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const salesService = new SalesService()
