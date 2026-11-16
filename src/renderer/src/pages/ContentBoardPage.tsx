import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import {
  CONTENT_BODY_MAX,
  CONTENT_STATUSES,
  CONTENT_STATUS_LABEL,
  CONTENT_TITLE_MAX,
  PLATFORMS,
  PLATFORM_LABEL,
  countByStatus,
  sortByScheduled,
  validateContent,
  type ContentItem,
  type ContentStatus,
  type Platform
} from '@renderer/services/content/contentModel'
import { deleteContent, listContent, saveContent } from '@renderer/services/content/contentService'
import OpsDesk from '@renderer/components/content/OpsDesk'

/**
 * 콘텐츠 보드 (대표 전용, 1단계). 아이디어 → 제작 → 예약 → 게시 상태를 관리한다.
 * 자동 게시는 하지 않는다. 예약 목록을 보고 사람이 직접 올린다.
 * 색은 명시 값 사용(앱 slate 반전 회피).
 */

const NAVY = '#0e1e3a'
const MUTED = '#64748b'
const LINE = '#cbd5e1'

type Draft = {
  id?: string
  title: string
  body: string
  platforms: Platform[]
  status: ContentStatus
  scheduledAt: string
}
const EMPTY: Draft = { title: '', body: '', platforms: [], status: 'idea', scheduledAt: '' }

/** ISO → datetime-local 입력값(로컬 시각). */
function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function ContentBoardPage(): JSX.Element {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [filter, setFilter] = useState<ContentStatus | 'all'>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | undefined>()

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await listContent()
    if (res.ok) {
      setItems(res.data)
      setLoadError(undefined)
    } else {
      setLoadError(res.message)
    }
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])

  const counts = useMemo(() => countByStatus(items), [items])
  const visible = useMemo(() => {
    const sorted = sortByScheduled(items)
    return filter === 'all' ? sorted : sorted.filter((c) => c.status === filter)
  }, [items, filter])

  const onSave = async (): Promise<void> => {
    if (!draft) return
    const v = validateContent({ title: draft.title, body: draft.body, platforms: draft.platforms, status: draft.status, scheduledAt: draft.scheduledAt || undefined })
    if (!v.ok) {
      setNotice({ kind: 'err', text: v.error ?? '입력을 확인해 주세요.' })
      return
    }
    setBusy(true)
    setNotice(undefined)
    const res = await saveContent({
      id: draft.id,
      title: draft.title,
      body: draft.body,
      platforms: draft.platforms,
      status: draft.status,
      scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : undefined
    })
    setBusy(false)
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.message })
      return
    }
    // 저장 성공은 서버 응답 기준으로만 표시
    setItems((prev) => (draft.id ? prev.map((x) => (x.id === res.data.id ? res.data : x)) : [res.data, ...prev]))
    setDraft({ id: res.data.id, title: res.data.title, body: res.data.body, platforms: res.data.platforms, status: res.data.status, scheduledAt: toLocalInput(res.data.scheduledAt) })
    setNotice({ kind: 'ok', text: '저장되었습니다.' })
  }

  const onDelete = async (): Promise<void> => {
    if (!draft?.id) return
    if (!window.confirm('이 콘텐츠를 삭제할까요? 되돌릴 수 없습니다.')) return
    setBusy(true)
    const res = await deleteContent(draft.id)
    setBusy(false)
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.message })
      return
    }
    setItems((prev) => prev.filter((x) => x.id !== draft.id))
    setDraft(null)
    setNotice(undefined)
  }

  const togglePlatform = (p: Platform): void => {
    if (!draft) return
    const has = draft.platforms.includes(p)
    setDraft({ ...draft, platforms: has ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p] })
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold" style={{ color: NAVY }}>
            콘텐츠 보드
          </h1>
          <p className="text-[12px]" style={{ color: MUTED }}>
            대표 전용 · 자동 게시 없음 · 예약 목록을 보고 직접 올립니다
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => void load()} aria-label="새로고침" className="rounded-lg border p-2" style={{ borderColor: LINE, color: MUTED }}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft({ ...EMPTY })
              setNotice(undefined)
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold text-white"
            style={{ backgroundColor: NAVY }}
          >
            <Plus className="h-3.5 w-3.5" /> 새 콘텐츠
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2', color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : null}

      {/* 운영 데스크: 팀이 움직이는 모습 */}
      <OpsDesk items={items} />

      {/* 상태 필터 + 개수 */}
      <div className="flex flex-wrap gap-1.5">
        {(['all', ...CONTENT_STATUSES] as const).map((s) => {
          const label = s === 'all' ? `전체 ${items.length}` : `${CONTENT_STATUS_LABEL[s]} ${counts[s]}`
          const on = filter === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={on}
              className="whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-semibold"
              style={{ borderColor: on ? NAVY : LINE, backgroundColor: on ? NAVY : '#ffffff', color: on ? '#ffffff' : NAVY }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* 목록 */}
        <section className="rounded-2xl border bg-white p-2.5" style={{ borderColor: LINE }}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px]" style={{ color: MUTED }}>
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: MUTED }}>
              콘텐츠가 없습니다. ‘새 콘텐츠’로 추가하세요.
            </p>
          ) : (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {visible.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ id: c.id, title: c.title, body: c.body, platforms: c.platforms, status: c.status, scheduledAt: toLocalInput(c.scheduledAt) })
                      setNotice(undefined)
                    }}
                    aria-pressed={draft?.id === c.id}
                    className="w-full rounded-lg border px-2.5 py-2 text-left"
                    style={{ borderColor: draft?.id === c.id ? NAVY : LINE, backgroundColor: draft?.id === c.id ? '#f1f5f9' : '#ffffff' }}
                  >
                    <span className="block text-[11px] font-semibold" style={{ color: MUTED }}>
                      {CONTENT_STATUS_LABEL[c.status]}
                      {c.scheduledAt ? ` · ${toLocalInput(c.scheduledAt).replace('T', ' ')}` : ' · 날짜 미정'}
                    </span>
                    <span className="block truncate text-[13px] font-semibold" style={{ color: NAVY }}>
                      {c.title}
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: MUTED }}>
                      {c.platforms.map((p) => PLATFORM_LABEL[p]).join(' · ') || '플랫폼 미정'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 편집 */}
        <section className="rounded-2xl border bg-white p-3" style={{ borderColor: LINE }}>
          {!draft ? (
            <p className="py-16 text-center text-[13px]" style={{ color: MUTED }}>
              콘텐츠를 선택하거나 ‘새 콘텐츠’를 누르세요.
            </p>
          ) : (
            <div className="space-y-2.5">
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="제목 (예: 3가지 보험 체크 쇼츠)"
                aria-label="콘텐츠 제목"
                maxLength={CONTENT_TITLE_MAX + 20}
                className="w-full rounded-lg border px-3 py-2 text-[15px] font-semibold outline-none focus:border-[#0e1e3a]"
                style={{ borderColor: LINE, color: NAVY }}
              />

              <div>
                <p className="mb-1 text-[12px] font-semibold" style={{ color: MUTED }}>
                  플랫폼 (여러 개 선택)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => {
                    const on = draft.platforms.includes(p)
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePlatform(p)}
                        aria-pressed={on}
                        className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold"
                        style={{ borderColor: on ? NAVY : LINE, backgroundColor: on ? NAVY : '#ffffff', color: on ? '#ffffff' : NAVY }}
                      >
                        {PLATFORM_LABEL[p]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-semibold" style={{ color: MUTED }}>
                    상태
                  </span>
                  <select
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as ContentStatus })}
                    className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
                    style={{ borderColor: LINE, color: NAVY }}
                  >
                    {CONTENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {CONTENT_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-semibold" style={{ color: MUTED }}>
                    예약 날짜·시간 (비우면 미정)
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.scheduledAt}
                    onChange={(e) => setDraft({ ...draft, scheduledAt: e.target.value })}
                    className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
                    style={{ borderColor: LINE, color: NAVY }}
                  />
                </label>
              </div>

              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="대본·캡션·메모"
                aria-label="콘텐츠 내용"
                rows={12}
                maxLength={CONTENT_BODY_MAX + 500}
                className="w-full resize-y rounded-lg border px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-[#0e1e3a]"
                style={{ borderColor: LINE, color: NAVY }}
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px]" style={{ color: MUTED }}>
                  {draft.title.length}/{CONTENT_TITLE_MAX} · {draft.body.length}/{CONTENT_BODY_MAX}
                </span>
                <div className="flex items-center gap-1.5">
                  {draft.id ? (
                    <button
                      type="button"
                      onClick={() => void onDelete()}
                      disabled={busy}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-2 text-xs font-semibold disabled:opacity-60"
                      style={{ borderColor: '#fecaca', color: '#b91c1c' }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> 삭제
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void onSave()}
                    disabled={busy}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                    style={{ backgroundColor: NAVY }}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
                  </button>
                </div>
              </div>
              {notice ? (
                <p className="text-[12px] font-semibold" style={{ color: notice.kind === 'ok' ? '#047857' : '#b91c1c' }} role="status">
                  {notice.text}
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
