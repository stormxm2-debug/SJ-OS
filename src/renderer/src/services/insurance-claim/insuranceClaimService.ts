import { jarvisGptBrainService } from '@renderer/services/jarvis/JarvisGptBrainService'

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
  // 'data-question' mode routes to the analytical brain persona on the proxy.
  const res = await jarvisGptBrainService.ask(prompt, 'data-question')
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
