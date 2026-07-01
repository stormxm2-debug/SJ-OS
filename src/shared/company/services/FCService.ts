import { companyRepository, type CompanyCollectionKey } from '../CompanyRepository'
import type { FcRecord } from '../types'

export class FCService {
  private readonly key: CompanyCollectionKey = 'fc'

  get(id: string): FcRecord | null {
    return companyRepository.get<FcRecord>(this.key, id)
  }

  list(): FcRecord[] {
    return companyRepository.list<FcRecord>(this.key)
  }

  search(matcher: (item: FcRecord) => boolean): FcRecord[] {
    return companyRepository.search<FcRecord>(this.key, matcher)
  }

  create(entity: FcRecord) {
    return companyRepository.create<FcRecord>(this.key, entity)
  }

  update(id: string, updates: Partial<FcRecord>) {
    return companyRepository.update<FcRecord>(this.key, id, updates)
  }

  delete(id: string) {
    return companyRepository.delete(this.key, id)
  }
}

export const fcService = new FCService()
