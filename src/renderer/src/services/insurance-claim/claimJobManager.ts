import {
  analyzeClaimExpert,
  saveClaimAnalysis,
  won,
  type ClaimExpertResult,
  type ClaimProgress
} from './claimExpertService'
import { listPolicyTerms, saveWebTerms, type PolicyTerm } from './policyTermsService'
import { pushLocalNotification } from '@renderer/services/notifications/localNotify'

/**
 * 청구비서 백그라운드 분석 작업 매니저 (모듈 싱글톤).
 *
 * 분석 파이프라인을 페이지 컴포넌트 밖으로 옮겨, 다른 화면으로 이동해도
 * (페이지 언마운트) 분석이 계속 진행되게 한다. 여러 건을 연달아 걸면 큐에
 * 쌓여 한 건씩 순차 실행된다(엣지 함수·API 혼잡 방지 — 한 건 안에서 이미
 * 배치 3개 병렬). 완료/실패 시 로컬 알림 버스로 토스트+OS 알림을 쏜다.
 * 앱(탭)을 켜둔 동안 유지되는 인메모리 큐이며 서류는 여전히 저장되지 않는다.
 */

export type ClaimJobStatus = 'queued' | 'running' | 'done' | 'error'

export interface ClaimJobTermsRef {
  id: string
  insurer: string
  summary: unknown
  filePath?: string
}

export interface ClaimJob {
  id: string
  /** 알림·목록 표시용 한 줄 라벨 (예: "홍길동 · 서류 3개"). */
  label: string
  customerId: string | null
  customerName: string | null
  files: File[]
  policyTerms: ClaimJobTermsRef[]
  forcedTermIds: string[]
  status: ClaimJobStatus
  progress: ClaimProgress | null
  result: ClaimExpertResult | null
  error: string
  /** ANTHROPIC_API_KEY 미설정으로 실패했는지. */
  disabled: boolean
  usedTermIds: string[]
  /** 웹에서 확인돼 보관함에 자동 저장된 약관 라벨들. */
  autoSavedTermLabels: string[]
  /** 고객 선택 분석의 고객 기록 저장 상태. */
  saveState: 'idle' | 'saving' | 'saved' | 'failed'
  createdAt: number
  finishedAt: number | null
  /** 사용자가 결과를 열어봤는지 (재방문 시 자동 열기 판단용). */
  seen: boolean
}

/** 완료·실패 작업 보관 한도 — 초과분은 오래된 것부터 제거해 File 메모리 회수. */
const MAX_FINISHED = 8

let seq = 0
let pumping = false
const jobs: ClaimJob[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

/** 작업 목록 (등록 순서). 반환 배열은 내부 상태이므로 수정 금지 — 구독 후 복사해 쓰세요. */
export function getClaimJobs(): ClaimJob[] {
  return jobs
}

export function subscribeClaimJobs(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function markClaimJobSeen(id: string): void {
  const j = jobs.find((x) => x.id === id)
  if (j && !j.seen) {
    j.seen = true
    emit()
  }
}

/** 실행 중이 아닌 작업 제거 (대기 취소 / 완료·실패 정리). */
export function removeClaimJob(id: string): void {
  const i = jobs.findIndex((x) => x.id === id)
  if (i >= 0 && jobs[i].status !== 'running') {
    jobs.splice(i, 1)
    emit()
  }
}

export function hasActiveClaimJob(): boolean {
  return jobs.some((j) => j.status === 'queued' || j.status === 'running')
}

/** 진행률(%) — 페이지 진행 패널과 작업 목록 미니바가 함께 쓴다.
 *  정밀 파이프라인 v2: 준비→판독→약관 웹 대조(research)→종합→2차 감사(audit). */
export function claimProgressPct(progress: ClaimProgress | null): number {
  if (!progress) return 3
  if (progress.stage === 'prepare') {
    return Math.round((progress.batch / Math.max(progress.totalBatches, 1)) * 12) + 3
  }
  if (progress.stage === 'extract') {
    return Math.round((Math.max(progress.batch - 1, 0) / Math.max(progress.totalBatches, 1)) * 35) + 15
  }
  if (progress.stage === 'research') {
    return Math.round((Math.max(progress.batch - 1, 0) / Math.max(progress.totalBatches, 1)) * 22) + 52
  }
  if (progress.stage === 'synthesize') return 78
  return 91 // audit
}

/**
 * 분석 작업 등록 — 즉시 반환하고 백그라운드에서 순차 실행된다.
 * 완료 알림(OS)을 위해 권한이 미정이면 이때 1회 요청한다.
 */
export function enqueueClaimJob(args: {
  files: File[]
  customer: { id: string; name: string } | null
  policyTerms: ClaimJobTermsRef[]
  forcedTermIds: string[]
}): ClaimJob {
  const job: ClaimJob = {
    id: `claim-job-${++seq}-${Date.now()}`,
    label: `${args.customer ? `${args.customer.name} · ` : ''}서류 ${args.files.length}개`,
    customerId: args.customer?.id ?? null,
    customerName: args.customer?.name ?? null,
    files: [...args.files],
    policyTerms: args.policyTerms,
    forcedTermIds: [...args.forcedTermIds],
    status: 'queued',
    progress: null,
    result: null,
    error: '',
    disabled: false,
    usedTermIds: [],
    autoSavedTermLabels: [],
    saveState: 'idle',
    createdAt: Date.now(),
    finishedAt: null,
    seen: false
  }
  jobs.push(job)
  trimFinished()
  emit()
  // OS 알림 권한 — 분석을 걸어두고 자리를 비우는 시나리오이므로 여기서 확보
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  } catch {
    /* 권한 요청 실패해도 토스트는 동작 */
  }
  void pump()
  return job
}

function trimFinished(): void {
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error')
  let excess = finished.length - MAX_FINISHED
  for (const j of finished) {
    if (excess <= 0) break
    const i = jobs.indexOf(j)
    if (i >= 0) {
      jobs.splice(i, 1)
      excess -= 1
    }
  }
}

/** 큐 소비 루프 — 항상 한 건만 실행. */
async function pump(): Promise<void> {
  if (pumping) return
  const job = jobs.find((j) => j.status === 'queued')
  if (!job) return
  pumping = true
  job.status = 'running'
  emit()
  try {
    const res = await analyzeClaimExpert({
      files: job.files,
      customerName: job.customerName ?? undefined,
      onProgress: (p) => {
        job.progress = p
        emit()
      },
      policyTerms: job.policyTerms,
      forcedTermIds: job.forcedTermIds
    })
    if (!res.ok || !res.result) {
      job.status = 'error'
      job.error = res.error ?? '분석에 실패했습니다.'
      job.disabled = Boolean(res.disabled)
      job.finishedAt = Date.now()
      emit()
      pushLocalNotification({
        title: '보험금 분석 실패',
        body: `${job.label} — ${job.error}`,
        target: 'claim-assistant'
      })
    } else {
      job.status = 'done'
      job.result = res.result
      job.usedTermIds = res.usedTerms ?? []
      job.finishedAt = Date.now()
      emit()
      pushLocalNotification({
        title: '보험금 분석 완료 ✓',
        body: `${job.label} — 예상 ${won(res.result.grandTotal)}`,
        target: 'claim-assistant'
      })
      // 고객 기록 자동 저장 (페이지가 닫혀 있어도 수행)
      if (job.customerId) {
        job.saveState = 'saving'
        emit()
        const saved = await saveClaimAnalysis(job.customerId, res.result)
        job.saveState = saved.ok ? 'saved' : 'failed'
        emit()
      }
      // 웹에서 확인한 약관 → 보관함 자동 저장 (다음 분석부터 즉시 적용)
      if ((res.webTerms ?? []).length > 0) {
        try {
          const existing = await listPolicyTerms()
          const added: PolicyTerm[] = await saveWebTerms(res.webTerms as unknown[], existing)
          if (added.length > 0) {
            job.autoSavedTermLabels = added.map((t) => `${t.insurer} · ${t.productName}`)
            emit()
          }
        } catch {
          /* 자동 보관 실패는 분석 결과에 영향 없음 */
        }
      }
    }
  } catch {
    job.status = 'error'
    job.error = '분석 중 예기치 못한 오류가 발생했습니다. 다시 시도해 주세요.'
    job.finishedAt = Date.now()
    emit()
    pushLocalNotification({
      title: '보험금 분석 실패',
      body: `${job.label} — ${job.error}`,
      target: 'claim-assistant'
    })
  } finally {
    pumping = false
  }
  trimFinished()
  emit()
  void pump()
}
