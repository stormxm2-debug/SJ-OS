import { useEffect, useState } from 'react'
import { ServerCog, Play, Square, RefreshCw, Save, AlertTriangle } from 'lucide-react'
import type { RemoteRunnerConfig, RemoteRunnerStatus } from '@shared/remoteTaskPoll'

/**
 * 원격 작업 수신 러너(이슈 #76) 설정 화면.
 * - 데스크톱 앱(Electron)에서만 동작한다(웹에는 window.sj.remoteTask 없음).
 * - runnerId·켜고끄기·상태만 다루며, 자격정보(gh/git 로그인)는 PC 설정을 재사용한다.
 */
type RemoteApi = {
  getConfig(): Promise<RemoteRunnerConfig>
  setConfig(patch: Partial<RemoteRunnerConfig>): Promise<RemoteRunnerConfig>
  status(): Promise<RemoteRunnerStatus>
  start(): Promise<RemoteRunnerStatus>
  stop(): Promise<RemoteRunnerStatus>
}
function remoteApi(): RemoteApi | undefined {
  return (typeof window !== 'undefined' ? (window as unknown as { sj?: { remoteTask?: RemoteApi } }).sj?.remoteTask : undefined)
}

export default function RemoteRunnerSettingsPage(): JSX.Element {
  const api = remoteApi()
  const [cfg, setCfg] = useState<RemoteRunnerConfig | null>(null)
  const [status, setStatus] = useState<RemoteRunnerStatus | null>(null)
  const [authors, setAuthors] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    void (async () => {
      const c = await api.getConfig()
      setCfg(c)
      setAuthors((c.allowedAuthors ?? []).join(', '))
      setStatus(await api.status())
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!api) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-white p-5">
        <div className="flex items-center gap-2 text-[14px] font-bold text-slate-100"><ServerCog className="h-4 w-4 text-[#c6982f]" /> 원격 작업 수신 러너</div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>이 기능은 <b>PC 데스크톱 앱(설치형)</b> 에서만 동작합니다. 지금 보고 계신 건 웹 버전이라 사용할 수 없어요. 원격 실행을 돌릴 PC의 SJ-OS 데스크톱 앱에서 이 화면을 열어 설정하세요.</span>
        </div>
      </div>
    )
  }

  const save = async (): Promise<void> => {
    if (!cfg) return
    setBusy('저장'); setNotice(null)
    const next = await api.setConfig({ ...cfg, allowedAuthors: authors.split(',').map((s) => s.trim()).filter(Boolean) })
    setCfg(next); setBusy(null); setNotice('설정을 저장했습니다.')
  }
  const act = async (fn: () => Promise<RemoteRunnerStatus>, label: string): Promise<void> => {
    setBusy(label); setNotice(null)
    setStatus(await fn()); setBusy(null); setNotice(`${label} 완료`)
  }

  const field = 'mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-[#0f172a] outline-none focus:border-[#c6982f]'
  const btn = 'inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold disabled:opacity-50'

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-white p-5">
        <div className="flex items-center gap-2 text-[14px] font-bold text-slate-100"><ServerCog className="h-4 w-4 text-[#c6982f]" /> 원격 작업 수신 러너 (이슈 #76)</div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">이 PC가 GitHub 이슈의 지정 작업을 수신해 기존 Claude 실행기로 코드 작성·검증하고 검토용 PR·결과를 자동으로 남깁니다. <b className="text-slate-300">main 병합·배포는 하지 않습니다.</b></p>

        {status ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className={`rounded-full px-2.5 py-1 font-semibold ${status.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{status.active ? '실행 중' : '정지됨'}</span>
            <span className="text-slate-400">runner: <b className="text-slate-200">{status.runnerId || '(미설정)'}</b> · 이슈 #{status.issueNumber}</span>
            {status.lastActions?.length ? <span className="text-slate-500">최근: {status.lastActions.slice(0, 3).join(', ')}</span> : null}
          </div>
        ) : null}

        {cfg ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-slate-400">이 PC runner id (예: PC-대표-01)
              <input value={cfg.runnerId} onChange={(e) => setCfg({ ...cfg, runnerId: e.target.value })} placeholder="PC-대표-01" className={field} />
            </label>
            <label className="text-[11px] font-semibold text-slate-400">허용 작성자(쉼표로 구분)
              <input value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="stormxm2-debug" className={field} />
            </label>
            <label className="text-[11px] font-semibold text-slate-400">이슈 번호
              <input type="number" value={cfg.issueNumber} onChange={(e) => setCfg({ ...cfg, issueNumber: Number(e.target.value) || cfg.issueNumber })} className={field} />
            </label>
            <label className="text-[11px] font-semibold text-slate-400">확인 주기(초, 최소 15)
              <input type="number" value={cfg.pollSeconds} onChange={(e) => setCfg({ ...cfg, pollSeconds: Math.max(15, Number(e.target.value) || 60) })} className={field} />
            </label>
            <label className="col-span-full flex items-center gap-2 text-[12px] font-semibold text-slate-300">
              <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
              앱 시작 시 자동으로 켜기(활성화)
            </label>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => void save()} className={`${btn} bg-[#0e1e3a] text-white`}><Save className="h-3.5 w-3.5" /> 저장</button>
          <button type="button" disabled={!!busy} onClick={() => void act(api.start, '시작')} className={`${btn} bg-emerald-600 text-white`}><Play className="h-3.5 w-3.5" /> 시작</button>
          <button type="button" disabled={!!busy} onClick={() => void act(api.stop, '정지')} className={`${btn} bg-rose-600 text-white`}><Square className="h-3.5 w-3.5" /> 정지</button>
          <button type="button" disabled={!!busy} onClick={() => void act(api.status, '상태 새로고침')} className={`${btn} bg-slate-700 text-slate-200`}><RefreshCw className="h-3.5 w-3.5" /> 상태</button>
        </div>
        {notice ? <p className="mt-2 text-[11px] text-emerald-400">{notice}</p> : null}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-white p-5 text-[12px] leading-relaxed text-slate-300">
        <div className="font-bold text-slate-100">설치 체크리스트</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
          <li>이 PC에 <b className="text-slate-300">gh(깃허브) 로그인</b>(<code>gh auth login</code>)과 git·Claude Code CLI가 설치돼 있어야 합니다.</li>
          <li>위에서 <b className="text-slate-300">runner id</b>를 정하고(예: PC-대표-01), 허용 작성자에 본인 GitHub 아이디를 넣고 <b className="text-slate-300">저장</b> → <b className="text-slate-300">시작</b>.</li>
          <li>GitHub 이슈 #{cfg?.issueNumber ?? 76}에 아래 형식 댓글을 남기면 이 PC가 수신해 실행합니다(runner가 정확히 일치해야 함).</li>
        </ol>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-2 text-[11px] text-slate-200">{'```sj-run\ntask: smoke-001\nrunner: ' + (cfg?.runnerId || 'PC-대표-01') + '\ntitle: 스모크 테스트\n---\ndocs/REMOTE_SMOKE.md 파일을 만들어 "ok" 한 줄 작성.\n```'}</pre>
        <p className="mt-2 text-[11px] text-slate-500">실행 결과는 검토용 PR과 이슈 댓글로 자동 게시됩니다. 자격정보·고객정보·전체 로그는 게시하지 않습니다.</p>
      </div>
    </div>
  )
}
