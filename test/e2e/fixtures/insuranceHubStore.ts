// E2E 합성 hub 스토어(교차기능 고객 선택). 최소 구현.
type Cust = { id: string; name: string } | null
let current: Cust = null
const subs = new Set<(c: Cust) => void>()

export function getHubCustomer(): Cust {
  return current
}
export function setHubCustomer(c: Cust): void {
  current = c
  subs.forEach((f) => f(c))
}
export function subscribeHubCustomer(f: (c: Cust) => void): () => void {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
