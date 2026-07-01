import type { CompanySnapshot } from './types'
import { mockCompanySnapshot } from './mockData'

export class CompanyState {
  private snapshot: CompanySnapshot

  constructor(snapshot: CompanySnapshot = mockCompanySnapshot) {
    this.snapshot = snapshot
  }

  getSnapshot(): CompanySnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: CompanySnapshot): void {
    this.snapshot = snapshot
  }
}
