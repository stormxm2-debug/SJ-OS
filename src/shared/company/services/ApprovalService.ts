import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { ApprovalRecord } from '../types'

export class ApprovalService {
  private readonly key: CompanyCollectionKey = 'approvals'

  get(id: string): ApprovalRecord | null {
    return companyRepository.get<ApprovalRecord>(this.key, id)
  }

  list(): ApprovalRecord[] {
    return companyRepository.list<ApprovalRecord>(this.key)
  }

  search(matcher: (item: ApprovalRecord) => boolean): ApprovalRecord[] {
    return companyRepository.search<ApprovalRecord>(this.key, matcher)
  }

  create(entity: ApprovalRecord) {
    return companyRepository.create<ApprovalRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<ApprovalRecord>) {
    return companyRepository.update<ApprovalRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const approvalService = new ApprovalService()
