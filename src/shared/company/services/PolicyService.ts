import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { PolicyRecord } from '../types'

export class PolicyService {
  private readonly key: CompanyCollectionKey = 'policies'

  get(id: string): PolicyRecord | null {
    return companyRepository.get<PolicyRecord>(this.key, id)
  }

  list(): PolicyRecord[] {
    return companyRepository.list<PolicyRecord>(this.key)
  }

  search(matcher: (item: PolicyRecord) => boolean): PolicyRecord[] {
    return companyRepository.search<PolicyRecord>(this.key, matcher)
  }

  create(entity: PolicyRecord) {
    return companyRepository.create<PolicyRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<PolicyRecord>) {
    return companyRepository.update<PolicyRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const policyService = new PolicyService()
