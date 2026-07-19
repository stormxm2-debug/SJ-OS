import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UploadCloud, UsersRound, Search, Download, Trash2, Loader2, RefreshCw, Users2 } from 'lucide-react'
import {
  loadContactsAsync,
  saveContactsAsync,
  subscribeContacts,
  contactsStorageMode,
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
 * 엑셀(「설계매니저」 양식)을 업로드하면 자동 인식·등록된다.
 * 카테고리(손해/생명)·직급(설계매니저/부지점장/지점장) 분리 + 검색 지원.
 *
 * 저장: Supabase 팀 공유(public.company_contacts) — 전 직원이 같은 목록을 실시간으로
 * 공유·수정한다(RLS authenticated 허용). Supabase 미설정 시 브라우저 localStorage.
 *
 * 색상 주의: 이 앱은 slate 스케일을 반전 리맵(tailwind.config.js)한다 —
 * 어두운 본문 글씨는 text-slate-100/200/300, 밝은 면은 bg-white / bg-slate-950.
 */

type StatusKind = 'ok' | 'err'
type RankKey = 'all' | 'manager' | 'vice' | 'head'

const EMPTY: ContactsData = { sonbo: [], saengbo: [] }

const RANK_LABEL: Record<Exclude<RankKey, 'all'>, string> = {
  manager: '설계매니저',
  vice: '부지점장',
  head: '지점장'
}

interface PersonRow {
  no: number
  company: string
  rank: Exclude<RankKey, 'all'>
  name: string
  phone: string
}

export default function ManagerContactsPage(): JSX.Element {
  const mode = contactsStorageMode()
  const shared = mode === 'shared'
  const canEdit = true // 팀 공유 목록은 로그인한 전 직원이 수정 가능(RLS도 authenticated 허용)

  const [data, setData] = useState<ContactsData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<'all' | Category>('all')
  const [rankFilter, setRankFilter] = useState<RankKey>('all')
  const [replaceMode, setReplaceMode] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<{ kind: StatusKind; msg: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => countContacts(data), [data])

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setData(await loadContactsAsync())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const unsub = subscribeContacts(() => {
      void loadContactsAsync().then(setData)
    })
    return unsub
  }, [reload])

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
      try {
        await saveContactsAsync(next)
      } catch (e) {
        setStatus({ kind: 'err', msg: (e as Error).message })
        return
      }
      setData(next)
      setStatus({
        kind: 'ok',
        msg: `「${file.name}」 등록 완료 — 보험사 ${parsed.companies}곳, 설계매니저 ${parsed.managers}명 (${replaceMode ? '덮어쓰기' : '병합'})${shared ? ' · 팀 전체에 반영됨' : ''}`
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

  const clearAll = async (): Promise<void> => {
    if (!window.confirm('등록된 모든 매니저 연락처를 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return
    try {
      await saveContactsAsync(EMPTY)
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message })
      return
    }
    setData(EMPTY)
    setStatus({ kind: 'ok', msg: `전체 삭제되었습니다.${shared ? ' 팀 전체에 반영됨' : ''}` })
  }

  const q = query.trim().toLowerCase()
  const cats: Category[] = catFilter === 'all' ? ['sonbo', 'saengbo'] : [catFilter]

  // 회사 단위 검색(직급 전체 보기용)
  const companyMatches = (co: CompanyContacts): boolean => {
    if (!q) return true
    const hay = [co.company, co.vice, co.vicePhone, co.head, co.headPhone]
    co.managers.forEach((m) => hay.push(m.name, m.phone))
    return hay.join(' ').toLowerCase().includes(q)
  }

  // 직급별 보기: 한 카테고리에서 선택 직급의 사람 목록(검색 반영)
  const peopleOf = (cat: Category, rank: Exclude<RankKey, 'all'>): PersonRow[] => {
    const rows: PersonRow[] = []
    let n = 0
    for (const co of data[cat]) {
      const add = (name: string, phone: string): void => {
        if (!name) return
        n += 1
        if (q && !`${co.company} ${name} ${phone}`.toLowerCase().includes(q)) return
        rows.push({ no: n, company: co.company, rank, name, phone })
      }
      if (rank === 'manager') co.managers.forEach((m) => add(m.name, m.phone))
      else if (rank === 'vice') add(co.vice, co.vicePhone)
      else add(co.head, co.headPhone)
    }
    return rows
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <UsersRound className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">매니저 연락처</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
            보험사 {counts.companies} · 설계매니저 {counts.managers}
          </span>
          {shared ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
              <Users2 className="h-3 w-3" /> 팀 공유 · 실시간
            </span>
          ) : (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/70">이 기기 저장</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void reload()}
            title="새로고침"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
          >
            <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} /> 새로고침
          </button>
          <button
            type="button"
            onClick={() => exportContacts(data)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" /> 엑셀 내보내기
          </button>
        </div>
      </div>

      {/* 업로드 — 팀 공유 목록은 로그인한 전 직원이 수정할 수 있습니다 */}
      {canEdit ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-100">엑셀 업로드로 자동 등록</div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            「설계매니저」 양식(손보사·생보사 표)을 그대로 인식합니다.
            {shared ? ' 업로드하면 팀 전체 목록이 즉시 갱신됩니다.' : ' 파일은 이 브라우저에서만 처리됩니다.'}
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
      ) : null}

      {/* 필터/검색 */}
      <div className="space-y-2.5 rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* 카테고리(손해/생명) */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">구분</span>
            <Segmented
              value={catFilter}
              onChange={(v) => setCatFilter(v as 'all' | Category)}
              options={[
                { key: 'all', label: '전체' },
                { key: 'sonbo', label: '손해(손보)' },
                { key: 'saengbo', label: '생명(생보)' }
              ]}
            />
          </div>
          {/* 직급 */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">직급</span>
            <Segmented
              value={rankFilter}
              onChange={(v) => setRankFilter(v as RankKey)}
              options={[
                { key: 'all', label: '전체' },
                { key: 'manager', label: '설계매니저' },
                { key: 'vice', label: '부지점장' },
                { key: 'head', label: '지점장' }
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 · 보험사 · 연락처 검색"
              className="w-full rounded-lg border border-slate-700 bg-white py-2 pl-8 pr-3 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
              설계매니저 {counts.managers} · 부지점장/지점장 {counts.leaders}
            </span>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void clearAll()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-rose-500 transition hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> 전체 삭제
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-white p-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 매니저 연락처를 불러오는 중…
        </div>
      ) : counts.companies === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-10 text-center text-sm text-slate-500">
          등록된 연락처가 없습니다.{canEdit ? ' 위에서 엑셀 파일을 업로드해 주세요.' : ''}
        </div>
      ) : (
        (() => {
          let anyShown = false
          const blocks = cats.map((cat) => {
            if (rankFilter === 'all') {
              const companies = data[cat].filter(companyMatches)
              if (companies.length === 0) return null
              anyShown = true
              const mgrCount = companies.reduce((n, c) => n + c.managers.length, 0)
              return (
                <CategoryBlock
                  key={cat}
                  cat={cat}
                  countText={`보험사 ${companies.length} · 설계매니저 ${mgrCount}명`}
                >
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
                </CategoryBlock>
              )
            }
            // 직급별 보기
            const people = peopleOf(cat, rankFilter)
            if (people.length === 0) return null
            anyShown = true
            return (
              <CategoryBlock key={cat} cat={cat} countText={`${RANK_LABEL[rankFilter]} ${people.length}명`}>
                <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-white shadow-sm">
                  <table className="w-full min-w-[420px] text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                        <th className="px-3 py-2.5 font-semibold">No</th>
                        <th className="px-3 py-2.5 font-semibold">보험사</th>
                        <th className="px-3 py-2.5 font-semibold">{RANK_LABEL[rankFilter]}</th>
                        <th className="px-3 py-2.5 font-semibold">연락처</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((p, i) => {
                        const digits = p.phone.replace(/[^0-9+]/g, '')
                        return (
                          <tr key={`${p.company}-${p.name}-${i}`} className="border-b border-slate-800 last:border-0 hover:bg-slate-950">
                            <td className="px-3 py-2.5 tabular-nums text-slate-500">{p.no}</td>
                            <td className="px-3 py-2.5 font-bold text-slate-100">{p.company}</td>
                            <td className="px-3 py-2.5 font-semibold text-slate-200">{p.name}</td>
                            <td className="px-3 py-2.5">
                              {p.phone ? (
                                <a href={`tel:${digits}`} className="tabular-nums text-indigo-600 hover:underline">
                                  {p.phone}
                                </a>
                              ) : (
                                <Dash />
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CategoryBlock>
            )
          })
          if (!anyShown) {
            return (
              <div className="rounded-2xl border border-slate-800 bg-white p-10 text-center text-sm text-slate-500">
                검색 결과가 없습니다.
              </div>
            )
          }
          return <div className="space-y-4">{blocks}</div>
        })()
      )}
    </div>
  )
}

function CategoryBlock({
  cat,
  countText,
  children
}: {
  cat: Category
  countText: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="space-y-2">
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
        <span className="text-[12px] text-slate-500">· {countText}</span>
      </div>
      {children}
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: { key: string; label: string }[]
}): JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5">
      {options.map((o) => {
        const active = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className={[
              'rounded-md px-2.5 py-1 text-[12px] font-semibold transition',
              active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-200'
            ].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
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
