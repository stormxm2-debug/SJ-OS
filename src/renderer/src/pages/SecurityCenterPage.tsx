import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck,
  Radar,
  Play,
  Square,
  RefreshCw,
  Network,
  Info,
  Loader2,
  Eye,
  Zap,
  Lightbulb
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import {
  CATEGORY_LABEL,
  KIND_LABEL,
  type DependencyGraph,
  type ElementCategory,
  type EngineState,
  type InsurerProfile,
  type LearnedElement
} from '@shared/securityLearning'

/**
 * 보안 모듈 탐지·학습 센터 (읽기 전용).
 *
 * 자동 보안 모듈 탐지 및 학습 엔진의 관찰 결과를 보여준다. 1차는 **관찰·학습 전용**으로,
 * 이 화면과 엔진 어디에서도 프로세스를 종료하지 않는다. 사용자는 프로세스/서비스를 직접
 * 확인·등록하지 않으며, 엔진이 전산 실행 전후 상태 변화를 자동 학습한다.
 *
 * 흐름: 보험사 선택 → “학습 시작(기준 스냅샷)” → 보험사 전산 실행 → “실행 후 학습” →
 * (전산 종료) “세션 종료”. 반복할수록 분류·신뢰점수가 정교해진다.
 */

function api(): Window['sj']['securityLearning'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.securityLearning : undefined
}

const CATEGORY_STYLE: Record<ElementCategory, string> = {
  'insurer-exclusive': 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'insurer-shared': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'windows-system': 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  'security-av': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'business-common': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  unknown: 'bg-slate-600/15 text-slate-400 border-slate-600/30',
  'never-terminate': 'bg-rose-500/15 text-rose-300 border-rose-500/30'
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'bg-emerald-500'
  if (c >= 0.5) return 'bg-amber-500'
  return 'bg-slate-500'
}

/** 로컬에서 새 보험사를 만들 때 쓰는 기본 후보(사용자가 직접 입력해도 됨). */
const INSURER_SUGGESTIONS = ['A', 'C', 'D']

export default function SecurityCenterPage(): JSX.Element {
  const available = !!api()
  const [state, setState] = useState<EngineState | null>(null)
  const [insurers, setInsurers] = useState<InsurerProfile[]>([])
  const [selected, setSelected] = useState<string>('')
  const [learned, setLearned] = useState<LearnedElement[]>([])
  const [graph, setGraph] = useState<DependencyGraph | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [newInsurer, setNewInsurer] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const a = api()
    if (!a) return
    const [st, ins] = await Promise.all([a.getState(), a.listInsurers()])
    setState(st)
    setInsurers(ins)
    setSelected((prev) => prev || st.activeSession?.insurerId || ins[0]?.id || '')
  }, [])

  const loadForInsurer = useCallback(async (insurerId: string): Promise<void> => {
    const a = api()
    if (!a || !insurerId) {
      setLearned([])
      setGraph(null)
      return
    }
    const [el, g] = await Promise.all([a.listLearned(insurerId), a.getGraph(insurerId)])
    setLearned(el)
    setGraph(g)
  }, [])

  useEffect(() => {
    void refresh()
    const a = api()
    const off = a?.onStateChange((st) => {
      setState(st)
      void api()
        ?.listInsurers()
        .then(setInsurers)
    })
    return off
  }, [refresh])

  useEffect(() => {
    if (selected) void loadForInsurer(selected)
  }, [selected, state?.updatedAt, loadForInsurer])

  const active = state?.activeSession ?? null

  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try {
      await fn()
      await refresh()
      if (selected) await loadForInsurer(selected)
    } finally {
      setBusy(null)
    }
  }

  const beginSession = (insurerId: string, insurerName?: string): void => {
    setSelected(insurerId)
    void run('begin', async () => api()?.beginSession(insurerId, insurerName))
  }

  const grouped = useMemo(() => {
    const g = new Map<ElementCategory, LearnedElement[]>()
    for (const el of learned) {
      const arr = g.get(el.category) ?? []
      arr.push(el)
      g.set(el.category, arr)
    }
    return g
  }, [learned])

  if (!available) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Header />
        <Card>
          <div className="flex items-start gap-3 text-sm text-slate-300">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              이 기능은 데스크톱(Electron) 앱의 메인 프로세스에서만 동작합니다. 웹/모바일에서는
              보안 모듈 학습 엔진에 접근할 수 없습니다.
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const unsupported = state?.support === 'unsupported'

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Header />

      {/* 관찰 전용 안내 배너 */}
      <div className="flex items-start gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-5 py-4 text-sm text-sky-200">
        <Eye className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="font-semibold text-sky-100">관찰·학습 전용 모드</div>
          현재 단계에서는 어떤 프로세스·서비스·드라이버도 종료하지 않습니다. 엔진은 보험사 전산
          실행 전후의 Windows 상태 변화를 자동으로 학습해 소속을 분류하고 신뢰점수를 쌓습니다.
          자동 실행/정리 종료는 신뢰점수가 충분히 축적된 뒤 별도 단계에서 활성화됩니다.
        </div>
      </div>

      {/* 완전 자동 감지 토글 */}
      {state && (
        <Card title="완전 자동 감지" icon={<Zap className="h-4 w-4" />}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 text-sm text-slate-300">
              <p>
                켜두면 <b className="text-slate-100">아무것도 누르지 않아도</b> 앱이 알아서 보험사 전산
                실행을 감지해 학습하고, 늦게 뜨는 보안 모듈까지 자동으로 한 번 더 보완합니다.
              </p>
              {state.autoWatch.enabled && state.autoWatch.lastEventText && (
                <p className="mt-2 text-xs text-emerald-300">
                  최근: {state.autoWatch.lastEventText}
                  {state.autoWatch.lastEventAt
                    ? ` · ${new Date(state.autoWatch.lastEventAt).toLocaleTimeString('ko-KR')}`
                    : ''}
                </p>
              )}
              {state.autoWatch.activeInsurerName && (
                <p className="mt-1 text-xs text-indigo-300">
                  지금 자동 학습 중: {state.autoWatch.activeInsurerName}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={unsupported || busy === 'auto'}
              onClick={() =>
                void run('auto', async () => api()?.setAutoWatch(!state.autoWatch.enabled))
              }
              aria-pressed={state.autoWatch.enabled}
              className={[
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-40',
                state.autoWatch.enabled ? 'bg-emerald-500' : 'bg-slate-600'
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-5 w-5 transform rounded-full bg-white transition',
                  state.autoWatch.enabled ? 'translate-x-6' : 'translate-x-1'
                ].join(' ')}
              />
            </button>
          </div>
        </Card>
      )}

      {/* 자동으로 파악한 보완할 점 */}
      {state && state.improvements.length > 0 && (
        <Card title="자동으로 파악한 보완할 점" icon={<Lightbulb className="h-4 w-4" />}>
          <div className="space-y-1.5">
            {state.improvements.slice(0, 8).map((h, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-300"
              >
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>{h.message}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            이 항목들은 사용자가 조치하지 않아도 전산을 반복 실행하는 동안 자동으로 채워집니다.
          </p>
        </Card>
      )}

      {unsupported && (
        <Card>
          <div className="flex items-start gap-3 text-sm text-slate-300">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>이 엔진은 Windows에서만 동작합니다. 현재 환경에서는 수집이 비활성화됩니다.</div>
          </div>
        </Card>
      )}

      {/* 요약 */}
      {state && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="학습된 보험사" value={state.summary.insurerCount} />
          <Stat label="학습 요소" value={state.summary.learnedCount} />
          <Stat label="제어 승격 후보" value={state.summary.controlEligibleCount} />
          <Stat label="엔진 상태" value={state.controlEnabled ? '제어 활성' : '관찰 전용'} />
        </div>
      )}

      {/* 학습 세션 컨트롤 */}
      <Card title="학습 세션" icon={<Radar className="h-4 w-4" />}>
        <div className="space-y-4">
          {active ? (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-indigo-100">
                  진행 중: <span className="font-semibold">{active.insurerId}</span> 보험사 ·{' '}
                  <span className="text-indigo-300">{sessionStatusLabel(active.status)}</span>
                </div>
                <div className="text-xs text-indigo-300">
                  신규 {active.appearedCount} · 변경 {active.changedCount}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton
                  onClick={() => void run('capture', async () => api()?.captureAfter())}
                  busy={busy === 'capture'}
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  label="실행 후 학습 (스냅샷 비교)"
                />
                <ActionButton
                  onClick={() => void run('end', async () => api()?.endSession())}
                  busy={busy === 'end'}
                  icon={<Square className="h-3.5 w-3.5" />}
                  label="세션 종료"
                  variant="ghost"
                />
              </div>
              <p className="mt-2 text-xs text-indigo-300/80">
                보험사 전산을 실행한 뒤 “실행 후 학습”을 누르세요. 지연 로딩되는 보안 모듈을 위해
                여러 번 눌러도 됩니다.
              </p>
            </div>
          ) : (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-400">보험사 학습 시작</div>
              <div className="flex flex-wrap items-center gap-2">
                {[...new Set([...INSURER_SUGGESTIONS, ...insurers.map((i) => i.id)])].map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!!busy || unsupported}
                    onClick={() => beginSession(id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-indigo-500/40 hover:text-white disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" /> {id} 보험사
                  </button>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    value={newInsurer}
                    onChange={(e) => setNewInsurer(e.target.value)}
                    placeholder="새 보험사 코드"
                    className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!newInsurer.trim() || !!busy || unsupported}
                    onClick={() => {
                      beginSession(newInsurer.trim(), newInsurer.trim())
                      setNewInsurer('')
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200 transition hover:text-white disabled:opacity-50"
                  >
                    시작
                  </button>
                </div>
                {busy === 'begin' && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                “학습 시작”을 누르면 실행 직전 기준 스냅샷을 자동으로 찍습니다.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* 보험사 선택 + 학습 결과 */}
      <Card
        title="학습된 보안 의존성"
        icon={<Network className="h-4 w-4" />}
        action={
          insurers.length > 0 ? (
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              {insurers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.totalSessions}회 학습)
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        {learned.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            {insurers.length === 0
              ? '아직 학습된 보험사가 없습니다. 위에서 학습을 시작하세요.'
              : '이 보험사에 대해 아직 수집된 요소가 없습니다. 전산 실행 후 “실행 후 학습”을 눌러주세요.'}
          </div>
        ) : (
          <div className="space-y-5">
            {([
              'insurer-exclusive',
              'insurer-shared',
              'security-av',
              'business-common',
              'windows-system',
              'never-terminate',
              'unknown'
            ] as ElementCategory[])
              .filter((cat) => (grouped.get(cat)?.length ?? 0) > 0)
              .map((cat) => (
                <div key={cat}>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={[
                        'rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                        CATEGORY_STYLE[cat]
                      ].join(' ')}
                    >
                      {CATEGORY_LABEL[cat]}
                    </span>
                    <span className="text-xs text-slate-500">{grouped.get(cat)?.length}개</span>
                  </div>
                  <div className="space-y-1.5">
                    {grouped.get(cat)?.map((el) => (
                      <ElementRow key={el.id} el={el} />
                    ))}
                  </div>
                </div>
              ))}
            {graph && graph.edges.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
                <div className="mb-1 font-medium text-slate-300">
                  부모·자식 관계 {graph.edges.length}건 관찰됨
                </div>
                {graph.edges.slice(0, 8).map((e, i) => (
                  <div key={i} className="truncate">
                    {shortPath(e.fromKey)} → {shortPath(e.toKey)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 최근 세션 */}
      {state && state.recentSessions.length > 0 && (
        <Card title="최근 학습 세션" icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="space-y-1.5">
            {state.recentSessions.slice(0, 8).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs"
              >
                <span className="font-medium text-slate-200">{s.insurerId} 보험사</span>
                <span className="text-slate-500">
                  신규 {s.appearedCount} · 변경 {s.changedCount} ·{' '}
                  {new Date(s.startedAt).toLocaleString('ko-KR')}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function Header(): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-indigo-500/30">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <div>
        <h1 className="text-lg font-bold tracking-tight text-slate-100">보안 모듈 탐지·학습 센터</h1>
        <p className="text-sm text-slate-500">
          보험사 전산의 보안 프로세스·서비스·드라이버를 자동 학습합니다 (관찰 전용)
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-100">{value}</div>
    </div>
  )
}

function ActionButton({
  onClick,
  busy,
  icon,
  label,
  variant = 'solid'
}: {
  onClick: () => void
  busy: boolean
  icon: JSX.Element
  label: string
  variant?: 'solid' | 'ghost'
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50',
        variant === 'solid'
          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-indigo-500/30 hover:shadow'
          : 'border border-slate-700 bg-slate-800/60 text-slate-200 hover:text-white'
      ].join(' ')}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function ElementRow({ el }: { el: LearnedElement }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-200">{el.label}</span>
            <span className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
              {KIND_LABEL[el.kind]}
            </span>
            {el.controlEligible && (
              <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                제어 승격
              </span>
            )}
            {el.lingersAfterExit && (
              <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                종료 후 잔존
              </span>
            )}
          </div>
          {el.detail.path && (
            <div className="mt-0.5 truncate text-[11px] text-slate-500">{el.detail.path}</div>
          )}
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
            <span>관찰 {el.observations}회 · {el.sessionsSeen}세션</span>
            {el.publisher && <span>게시자 {el.publisher}</span>}
            {el.signatureValid === true && <span className="text-emerald-400">서명 유효</span>}
            {el.signatureValid === false && <span className="text-rose-400">서명 무효</span>}
          </div>
        </div>
        <div className="w-24 shrink-0">
          <div className="mb-1 text-right text-[11px] font-semibold text-slate-300">
            {Math.round(el.confidence * 100)}%
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={['h-full rounded-full', confidenceColor(el.confidence)].join(' ')}
              style={{ width: `${Math.round(el.confidence * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function sessionStatusLabel(s: string): string {
  switch (s) {
    case 'baseline-captured':
      return '기준 스냅샷 완료'
    case 'observing':
      return '학습 중'
    case 'closed':
      return '종료됨'
    default:
      return '대기'
  }
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}
