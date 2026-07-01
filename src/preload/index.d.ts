import type { SjApi } from './index'

declare global {
  interface Window {
    sj: SjApi
  }
}

export {}
