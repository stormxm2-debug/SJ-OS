import type { ClaudeBuildCompletionReport } from '@shared/claudeAutoBuild'

/**
 * Local, persisted record of Claude build completion reports. This is the
 * "릴리즈 센터에 기록" store — kept local for now; surfacing these inside the full
 * Release Center page is a documented future step. No git / shell here.
 */

const KEY = 'sj.claude.completionReports'

export function recordCompletionReport(report: ClaudeBuildCompletionReport): void {
  try {
    const list = getRecordedReports()
    const next = [report, ...list.filter((r) => r.jobId !== report.jobId)].slice(0, 50)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* localStorage may be unavailable; recording is best-effort */
  }
}

export function getRecordedReports(): ClaudeBuildCompletionReport[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ClaudeBuildCompletionReport[]) : []
  } catch {
    return []
  }
}

/** Plain-text report for the clipboard (concise; no raw logs). */
export function formatReportText(r: ClaudeBuildCompletionReport): string {
  const lines = [
    `# 작업 완료 보고서 · ${r.title}`,
    '',
    `## 요청 내용`,
    r.originalUserCommand,
    '',
    `## 변경 요약`,
    r.releaseNote,
    '',
    `## 변경 파일 (${r.changedFiles.length})`,
    ...r.changedFiles.slice(0, 100),
    '',
    `## 검증 결과`,
    `- typecheck: ${r.verification.typecheckStatus}`,
    `- build: ${r.verification.buildStatus}`,
    '',
    `## 커밋 정보`,
    `- 커밋 해시: ${r.commitHash ?? '(미커밋)'}`,
    `- push 상태: ${r.pushStatus}`,
    '',
    `## 수동 테스트 체크리스트`,
    ...r.manualTestChecklist.map((c) => `- [ ] ${c}`),
    '',
    `## 다음 권장 작업`,
    ...r.nextRecommendedActions.map((a) => `- ${a}`)
  ]
  return lines.join('\n')
}
