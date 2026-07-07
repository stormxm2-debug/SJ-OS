import { jarvisGptBrainService } from '@renderer/services/jarvis/JarvisGptBrainService'
import { activeProxyUrl, detectProxyStatus, getLastWorkingUrl } from '@renderer/services/jarvis/proxyConfig'

/**
 * 보험금 청구비서 (Insurance Claim Assistant) service.
 *
 * Takes the user's policy/증권 info + incident/claim details, builds a Korean
 * insurance-expert prompt, and asks the Jarvis GPT brain (via the backend AI
 * proxy — the OpenAI key NEVER lives in the renderer). Returns a normalized
 * result the page renders. Stateless: this is an analysis tool, not a persisted
 * domain — persisting past estimates can be a future enhancement.
 */

export interface ClaimInput {
  /** 보험사 (기본 삼성화재) */
  insurer: string
  /** 증권 / 가입 담보 정보 (붙여넣기 또는 요약) */
  policyInfo: string
  /** 사고 / 청구 내용: 진단명 · 사고 경위 · 치료 내역 · 입원일수 등 */
  incident: string
}

export interface ClaimEstimate {
  ok: boolean
  /** GPT 프록시가 꺼져 있을 때 true — 설정 안내를 보여준다. */
  disabled: boolean
  /** 재시도가 안전한지 (네트워크/타임아웃 등). */
  canRetry: boolean
  /** AI가 생성한 전체 분석 텍스트. */
  answer: string
  /** 응답 첫머리의 "예상 총 보험금 …" 요약 한 줄 (있으면). */
  headline?: string
  error?: string
  source: string
}

export const DEFAULT_INSURER = '삼성화재'

/**
 * Build the Korean insurance-expert prompt. Deterministic (no clock/random) so it
 * is easy to test and to copy into any external AI when the proxy is disabled.
 */
export function buildClaimPrompt(input: ClaimInput): string {
  const insurer = input.insurer.trim() || DEFAULT_INSURER
  return [
    '당신은 대한민국 손해보험·생명보험 보험금 청구 전문가이자 손해사정 실무자입니다.',
    '아래 "가입/증권 정보"와 "사고/청구 내용"을 근거로 예상 지급 보험금을 분석하세요.',
    '',
    '## 반드시 지킬 응답 형식',
    '1) 응답 맨 첫 줄에 다음 형식으로 요약하세요: "예상 총 보험금: 약 OOO원 (범위 OOO원 ~ OOO원)"',
    '2) "■ 담보별 산정 내역" — 지급 가능 담보마다 [담보명 / 근거 약관 조항 / 산정 금액 / 산정 근거]를 표로 정리',
    '3) "■ 참고 사례" — 유사한 지급·분쟁조정 사례나 일반적 지급 관행 2~3건',
    '4) "■ 필요 서류" — 청구 시 준비할 서류 목록',
    '5) "■ 주의·리스크" — 부지급/삭감 가능성, 면책 조항, 자기부담금, 추가 확인이 필요한 사항',
    '',
    '불확실한 값은 반드시 "추정"임을 명시하고, 실제 지급액은 약관 심사·손해사정 결과에 따라 달라질 수 있음을 마지막 줄에 안내하세요.',
    '모든 금액은 한국 원(₩) 기준으로 제시하세요.',
    `보험사: ${insurer}`,
    '',
    '## 가입/증권 정보',
    input.policyInfo.trim() || '(제공되지 않음 — 일반적인 실손/정액 담보 가정 하에 보수적으로 분석)',
    '',
    '## 사고/청구 내용',
    input.incident.trim()
  ].join('\n')
}

/** Pull the "예상 총 보험금 …" headline line out of the answer, if present. */
function extractHeadline(answer: string): string | undefined {
  const line = answer.split(/\r?\n/).find((l) => l.includes('예상 총 보험금'))
  return line?.trim() || undefined
}

/**
 * Analyze a claim. Never throws — proxy-off / network errors come back as a
 * normalized result the page renders (with the prompt still available to copy).
 */
export async function estimateClaim(input: ClaimInput): Promise<ClaimEstimate> {
  const prompt = buildClaimPrompt(input)
  // 'insurance-claim' is an EXPERT mode on the proxy — it bypasses the snapshot-only
  // base instruction so the model answers from general insurance knowledge (a normal
  // company-data mode returns "데이터가 없습니다" for a claim question).
  const res = await jarvisGptBrainService.ask(prompt, 'insurance-claim')
  return {
    ok: res.success,
    disabled: Boolean(res.disabled),
    canRetry: Boolean(res.canRetry),
    answer: res.answer,
    headline: res.success ? extractHeadline(res.answer) : undefined,
    error: res.error,
    source: res.source
  }
}

const VISION_TIMEOUT_MS = 45000

/** Build the instruction that accompanies an uploaded document image. */
function buildVisionMessage(insurer: string, incident: string): string {
  return [
    '첨부한 보험 서류 이미지(증권/진단서/영수증 등)를 읽고 예상 지급 보험금을 분석하세요.',
    `보험사: ${insurer.trim() || DEFAULT_INSURER}`,
    incident.trim() ? `추가 사고/청구 내용: ${incident.trim()}` : '',
    '',
    '## 반드시 지킬 응답 형식',
    '1) 응답 맨 첫 줄에 "예상 총 보험금: 약 OOO원 (범위 OOO원 ~ OOO원)"',
    '2) "■ 이미지 판독" — 서류에서 읽어낸 핵심 정보(담보/진단명/치료·입원/금액). 흐릿해서 불확실한 부분은 명시',
    '3) "■ 담보별 산정 내역" 표 [담보명 / 근거 약관 조항 / 산정 금액 / 산정 근거]',
    '4) "■ 참고 사례" 2~3건, 5) "■ 필요 서류", 6) "■ 주의·리스크"',
    '불확실한 값은 "추정"임을 명시하고, 실제 지급은 약관 심사·손해사정 결과에 따라 달라질 수 있음을 마지막에 안내하세요.'
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Analyze a claim from an uploaded document IMAGE (증권/진단서/영수증 사진). Sends the
 * image to the proxy's /ai/vision endpoint (multipart; the OpenAI key stays on the
 * backend) and normalizes the response into a ClaimEstimate. Never throws.
 */
export async function analyzeClaimImage(
  file: File,
  opts?: { insurer?: string; incident?: string }
): Promise<ClaimEstimate> {
  if (!jarvisGptBrainService.isEnabled()) {
    return {
      ok: false,
      disabled: true,
      canRetry: false,
      answer: '',
      error: 'AI 프록시가 비활성화되어 있어 서류 이미지 분석을 사용할 수 없습니다.',
      source: 'disabled'
    }
  }
  // Make sure we know a reachable proxy URL before the (large) upload.
  if (!getLastWorkingUrl()) {
    await detectProxyStatus()
  }
  const base = activeProxyUrl()
  const form = new FormData()
  form.append('image', file)
  form.append('message', buildVisionMessage(opts?.insurer ?? DEFAULT_INSURER, opts?.incident ?? ''))
  form.append('mode', 'insurance-claim')

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), VISION_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/ai/vision`, { method: 'POST', body: form, signal: controller.signal })
    const data = (await res.json().catch(() => ({ success: false }))) as {
      success?: boolean
      answer?: string
      error?: string
      source?: string
      disabled?: boolean
    }
    if (!res.ok || !data.success) {
      return {
        ok: false,
        disabled: Boolean(data.disabled),
        canRetry: !data.disabled,
        answer: data.answer ?? '',
        error: data.error ?? `서류 이미지 분석에 실패했습니다 (HTTP ${res.status}).`,
        source: data.source ?? 'error'
      }
    }
    return {
      ok: true,
      disabled: false,
      canRetry: false,
      answer: data.answer ?? '',
      headline: extractHeadline(data.answer ?? ''),
      source: data.source ?? 'openai'
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return {
      ok: false,
      disabled: false,
      canRetry: true,
      answer: '',
      error: aborted
        ? '서류 이미지 분석이 시간 내에 완료되지 않았습니다 (타임아웃). 다시 시도해 주세요.'
        : 'AI 프록시에 연결할 수 없습니다. 프록시가 실행 중인지 확인해 주세요.',
      source: 'error'
    }
  } finally {
    window.clearTimeout(timer)
  }
}

const CLAIM_TIMEOUT_MS = 130000

/**
 * Analyze a claim with CLAUDE via the proxy's /ai/claim endpoint. Handles a text-only
 * request OR an attached document — Claude reads PDF and images natively (no OCR /
 * conversion). Never throws; proxy-off / key-missing / network errors come back as a
 * normalized ClaimEstimate (disabled → the page shows setup guidance).
 */
export async function analyzeClaim(input: {
  insurer: string
  policyInfo: string
  incident: string
  file?: File | null
}): Promise<ClaimEstimate> {
  if (!getLastWorkingUrl()) {
    await detectProxyStatus()
  }
  const base = activeProxyUrl()
  const hasFile = Boolean(input.file)
  const message = hasFile
    ? [
        buildVisionMessage(input.insurer, input.incident),
        input.policyInfo.trim() ? `\n## 가입/증권 정보(참고)\n${input.policyInfo.trim()}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    : buildClaimPrompt(input)

  const form = new FormData()
  form.append('message', message)
  if (input.file) form.append('document', input.file)

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CLAIM_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/ai/claim`, { method: 'POST', body: form, signal: controller.signal })
    const data = (await res.json().catch(() => ({ success: false }))) as {
      success?: boolean
      answer?: string
      error?: string
      source?: string
      disabled?: boolean
      code?: string
    }
    if (!res.ok || !data.success) {
      const disabled = Boolean(data.disabled) || data.code === 'ANTHROPIC_DISABLED'
      return {
        ok: false,
        disabled,
        canRetry: !disabled,
        answer: data.answer ?? '',
        error: data.error ?? `Claude 분석에 실패했습니다 (HTTP ${res.status}).`,
        source: data.source ?? 'error'
      }
    }
    return {
      ok: true,
      disabled: false,
      canRetry: false,
      answer: data.answer ?? '',
      headline: extractHeadline(data.answer ?? ''),
      source: data.source ?? 'claude'
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return {
      ok: false,
      disabled: false,
      canRetry: true,
      answer: '',
      error: aborted
        ? 'Claude 분석이 시간 내에 완료되지 않았습니다 (타임아웃). 다시 시도해 주세요.'
        : 'AI 프록시에 연결할 수 없습니다. 프록시가 실행 중인지 확인해 주세요.',
      source: 'error'
    }
  } finally {
    window.clearTimeout(timer)
  }
}
