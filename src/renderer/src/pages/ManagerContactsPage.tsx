import { useMemo, useRef, useState } from 'react'
import { UploadCloud, UsersRound, Search, Download, Trash2, Loader2 } from 'lucide-react'
import {
  loadContacts,
  saveContacts,
  parseWorkbook,
  mergeContacts,
  exportContacts,
  countContacts,
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  type Category,
  type ContactsData,
  type CompanyContacts
} from '@renderer/services/commercial/managerContacts'

/**
 * 매니저 연락처 — 보험사 설계매니저·부지점장·지점장 연락망.
 * 엑셀(「설계매니저」 양식)을 업로드하면 자동 인식·등록된다. 검색·필터·내보내기 지원.
 * 데이터는 브라우저에만 저장되며 서버로 전송되지 않는다.
 *
 * 색상 주의: 이 앱은 slate 스케일을 반전 리맵(tailwind.config.js)한다 —
 * 높은 숫자일수록 밝은 면, 낮은 숫자일수록 어두운 글씨. 그래서 어두운 본문 글씨는
 * text-slate-100/200/300, 밝은 면은 bg-white / bg-slate-950, 옅은 경계선은
 * border-slate-700/800 을 쓴다.
 */

type StatusKind = 'ok' | 'err'

export default function ManagerContactsPage(): JSX.Element {
  const [data, setData] = useState<ContactsData>(() => loadContacts())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Category>('all')
  const [replaceMode, setReplaceMode] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<{ kind: StatusKind; msg: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => countContacts(data), [data])

  const persist = (next: ContactsData): void => {
    setData(next)
    saveContacts(next)
  }

  const handleFile = async (file: File): Promise<void> => {
    setParsing(true)
    setStatus(null)
    try {
      const buf = await file.arrayBuffer()
      const parsed = parseWorkbook(buf)
      if (parsed.companies === 0) {
        setStatus({
          kind: 'err',
          msg: '인식할 수 있는 매니저 표를 찾지 못했습니다. 「구분/보험사/설계매니저/연락처」 형식인지 확인해 주세요.'
        })
        return
      }
      const next = replaceMode ? parsed.data : mergeContacts(data, parsed.data)
      persist(next)
      setStatus({
        kind: 'ok',
        msg: `「${file.name}」 등록 완료 — 보험사 ${parsed.companies}곳, 설계매니저 ${parsed.managers}명 (${replaceMode ? '덮어쓰기' : '병합'})`
      })
    } catch (e) {
      setStatus({ kind: 'err', msg: `파일을 읽는 중 오류가 발생했습니다: ${(e as Error).message}` })
    } finally {
      setParsing(false)
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
    e.target.value = ''
  }

  const clearAll = (): void => {
    if (!window.confirm('등록된 모든 매니저 연락처를 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return
    persist({ sonbo: [], saengbo: [] })
    setStatus({ kind: 'ok', msg: '전체 삭제되었습니다.' })
  }

  const matches = (co: CompanyContacts, q: string): boolean => {
    if (!q) return true
    const hay = [co.company, co.vice, co.vicePhone, co.head, co.headPhone]
    co.managers.forEach((m) => hay.push(m.name, m.phone))
    return hay.join(' ').toLowerCase().includes(q.toLowerCase())
  }

  const cats: Category[] = filter === 'all' ? ['sonbo', 'saengbo'] : [filter]
  const q = query.trim()

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex items-center gap-2">
          <UsersRound className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">매니저 연락처</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
            보험사 {counts.companies} · 설계매니저 {counts.managers}
          </span>
        </div>
        <button
          type="button"
          onClick={() => exportContacts(data)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
        >
          <Download className="h-3.5 w-3.5" /> 엑셀 내보내기
        </button>
      </div>

      {/* 업로드 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-100">엑셀 업로드로 자동 등록</div>
        <div className="mt-0.5 text-[12px] text-slate-500">
          「설계매니저」 양식(손보사·생보사 표)을 그대로 인식합니다. 파일은 이 브라우저에서만 처리되며 서버로 전송되지 않습니다.
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void handleFile(f)
          }}
          className={[
            'mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition',
            dragOver
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-slate-700 bg-slate-950 hover:border-indigo-400 hover:bg-indigo-50/40'
          ].join(' ')}
        >
          <UploadCloud className={['h-8 w-8', dragOver ? 'text-indigo-600' : 'text-slate-500'].join(' ')} />
          <div className="text-sm font-semibold text-slate-200">
            엑셀 파일을 드래그하거나 <span className="text-indigo-600">클릭해서 선택</span>
          </div>
          <div className="text-[11px] text-slate-500">.xlsx · .xls · .csv</div>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onPick} className="hidden" />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-500">
            <input
              type="checkbox"
              checked={replaceMode}
              onChange={(e) => setReplaceMode(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            업로드 시 기존 목록을 <b className="font-semibold text-slate-200">덮어쓰기</b> (해제 시 병합)
          </label>
        </div>

        {parsing ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 엑셀을 읽는 중…
          </div>
        ) : null}

        {status ? (
          <div
            className={[
              'mt-3 rounded-xl px-3 py-2.5 text-[13px] font-medium',
              status.kind === 'ok'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border border-rose-200 bg-rose-50 text-rose-600'
            ].join(' ')}
          >
            {status.kind === 'ok' ? '✅ ' : '⚠️ '}
            {status.msg}
          </div>
        ) : null}
      </div>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="rounded-full border border-slate-800 bg-white px-2.5 py-1 font-semibold text-slate-200 shadow-sm">
            설계매니저 {counts.managers}명
          </span>
          <span className="rounded-full border border-slate-800 bg-white px-2.5 py-1 font-semibold text-slate-200 shadow-sm">
            보험사 {counts.companies}곳
          </span>
          <span className="rounded-full border border-slate-800 bg-white px-2.5 py-1 font-semibold text-slate-200 shadow-sm">
            전체 인원 {counts.managers + counts.leaders}명
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 · 보험사 · 연락처 검색"
              className="w-56 rounded-lg border border-slate-700 bg-white py-2 pl-8 pr-3 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | Category)}
            className="rounded-lg border border-slate-700 bg-white px-2.5 py-2 text-[13px] text-slate-200 outline-none focus:border-indigo-400"
          >
            <option value="all">전체 구분</option>
            <option value="sonbo">손해보험(손보사)</option>
            <option value="saengbo">생명보험(생보사)</option>
          </select>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-rose-500 transition hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> 전체 삭제
          </button>
        </div>
      </div>

      {/* 목록 */}
      {counts.companies === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-10 text-center text-sm text-slate-500">
          등록된 연락처가 없습니다. 위에서 엑셀 파일을 업로드해 주세요.
        </div>
      ) : (
        cats.map((cat) => {
          const companies = data[cat].filter((co) => matches(co, q))
          if (companies.length === 0) return null
          const mgrCount = companies.reduce((n, c) => n + c.managers.length, 0)
          return (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span
                  className={[
                    'rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white',
                    cat === 'sonbo' ? 'bg-blue-600' : 'bg-emerald-600'
                  ].join(' ')}
                >
                  {CATEGORY_SHORT[cat]}
                </span>
                <h2 className="text-sm font-bold text-slate-100">{CATEGORY_LABEL[cat]}</h2>
                <span className="text-[12px] text-slate-500">
                  · 보험사 {companies.length} · 설계매니저 {mgrCount}명
                </span>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-white shadow-sm">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                      <th className="px-3 py-2.5 font-semibold">No</th>
                      <th className="px-3 py-2.5 font-semibold">보험사</th>
                      <th className="px-3 py-2.5 font-semibold">설계매니저</th>
                      <th className="px-3 py-2.5 font-semibold">부지점장</th>
                      <th className="px-3 py-2.5 font-semibold">지점장</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((co, i) => (
                      <tr key={`${co.company}-${i}`} className="border-b border-slate-800 last:border-0 hover:bg-slate-950">
                        <td className="px-3 py-2.5 align-top tabular-nums text-slate-500">{co.no}</td>
                        <td className="px-3 py-2.5 align-top font-bold text-slate-100">{co.company}</td>
                        <td className="px-3 py-2.5 align-top">
                          {co.managers.length ? (
                            <div className="space-y-1">
                              {co.managers.map((m, k) => (
                                <PersonLine key={k} name={m.name} phone={m.phone} />
                              ))}
                            </div>
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <PersonLine name={co.vice} phone={co.vicePhone} />
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <PersonLine name={co.head} phone={co.headPhone} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function PersonLine({ name, phone }: { name: string; phone: string }): JSX.Element {
  if (!name && !phone) return <Dash />
  const digits = phone.replace(/[^0-9+]/g, '')
  return (
    <div className="leading-tight">
      <span className="font-semibold text-slate-200">{name}</span>{' '}
      {phone ? (
        <a href={`tel:${digits}`} className="tabular-nums text-indigo-600 hover:underline">
          {phone}
        </a>
      ) : (
        <span className="text-slate-500">-</span>
      )}
    </div>
  )
}

function Dash(): JSX.Element {
  return <span className="text-slate-500">-</span>
}
