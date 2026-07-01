import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { CustomerRecord } from '../types'

export class CustomerService {
  private readonly key: CompanyCollectionKey = 'customers'

  get(id: string): CustomerRecord | null {
    return companyRepository.get<CustomerRecord>(this.key, id)
  }

  list(): CustomerRecord[] {
    return companyRepository.list<CustomerRecord>(this.key)
  }

  search(matcher: (item: CustomerRecord) => boolean): CustomerRecord[] {
    return companyRepository.search<CustomerRecord>(this.key, matcher)
  }

  create(entity: CustomerRecord) {
    return companyRepository.create<CustomerRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<CustomerRecord>) {
    return companyRepository.update<CustomerRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const customerService = new CustomerService()
