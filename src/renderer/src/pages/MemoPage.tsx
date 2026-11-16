import { useEffect, useMemo, useState } from 'react'
import { Loader2, Pin, PinOff, Plus, Search, Trash2, Save, RefreshCw } from 'lucide-react'
import {
  MEMO_BODY_MAX,
  MEMO_TITLE_MAX,
  filterMemos,
  memoDisplayTitle,
  sortMemos,
  validateMemo,
  type MemoItem
} from '@renderer/services/memo/memoModel'
import { deleteMemo, listMemos, saveMemo } from '@renderer/services/memo/memoService'

/** 개인 메모장. 계정별로 동기화된다(본인만 볼 수 있음). 색은 명시 값 사용(앱 slate 반전 회피). */

const NAVY = '#0e1e3a'
const MUTED = '#64748b'
const LINE = '#cbd5e1'

type Draft = { id?: string; title: string; body: string; pinned: boolean }
const EMPTY: Draft = { title: '', body: '', pinned: false }

export default function MemoPage(): JSX.Element {
  const [memos, setMemos] = useState<MemoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | undefined>()

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await listMemos()
    if (res.ok) {
      setMemos(res.data)
      setLoadError(undefined)
    } else {
      setLoadError(res.message)
    }
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])

  const visible = useMemo(() => sortMemos(filterMemos(memos, query)), [memos, query])

  const onSave = async (): Promise<void> => {
    if (!draft) return
    const v = validateMemo(draft.title, draft.body)
    if (!v.ok) {
      setNotice({ kind: 'err', text: v.error ?? '입력을 확인해 주세요.' })
      return
    }
    if (!draft.title.trim() && !draft.body.trim()) {
      setNotice({ kind: 'err', text: '제목이나 내용을 입력해 주세요.' })
      return
    }
    setBusy(true)
    setNotice(undefined)
    const res = await saveMemo({ id: draft.id, title: draft.title, body: draft.body, pinned: draft.pinned })
    setBusy(false)
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.message })
      return
    }
    // 저장 성공은 서버 응답 기준으로만 표시한다.
    setMemos((prev) => (draft.id ? prev.map((m) => (m.id === res.data.id ? res.data : m)) : [res.data, ...prev]))
    setDraft({ id: res.data.id, title: res.data.title, body: res.data.body, pinned: res.data.pinned })
    setNotice({ kind: 'ok', text: '저장되었습니다.' })
  }

  const onDelete = async (): Promise<void> => {
    if (!draft?.id) return
    if (!window.confirm('이 메모를 삭제할까요? 되돌릴 수 없습니다.')) return
    setBusy(true)
    const res = await deleteMemo(draft.id)
    setBusy(false)
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.message })
      return
    }
    setMemos((prev) => prev.filter((m) => m.id !== draft.id))
    setDraft(null)
    setNotice(undefined)
  }

  const togglePin = async (m: MemoItem): Promise<void> => {
    const res = await saveMemo({ id: m.id, title: m.title, body: m.body, pinned: !m.pinned })
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.message })
      return
    }
    setMemos((prev) => prev.map((x) => (x.id === res.data.id ? res.data : x)))
    if (draft?.id === m.id) setDraft({ ...draft, pinned: res.data.pinned })
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold" style={{ color: NAVY }}>
          메모장
        </h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void load()}
            aria-label="새로고침"
            className="rounded-lg border p-2 transition hover:text-[#0e1e3a]"
            style={{ borderColor: LINE, color: MUTED }}
          >
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
            <Plus className="h-3.5 w-3.5" /> 새 메모
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2', color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* 목록 */}
        <section className="rounded-2xl border bg-white p-2.5" style={{ borderColor: LINE }}>
          <label className="mb-2 flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: LINE }}>
            <Search className="h-3.5 w-3.5" style={{ color: MUTED }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="메모 검색"
              aria-label="메모 검색"
              className="w-full bg-transparent text-[13px] outline-none"
              style={{ color: NAVY }}
            />
          </label>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px]" style={{ color: MUTED }}>
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: MUTED }}>
              {query.trim() ? '검색 결과가 없습니다.' : '메모가 없습니다. ‘새 메모’로 추가하세요.'}
            </p>
          ) : (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {visible.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ id: m.id, title: m.title, body: m.body, pinned: m.pinned })
                      setNotice(undefined)
                    }}
                    className="flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition"
                    style={{
                      borderColor: draft?.id === m.id ? NAVY : LINE,
                      backgroundColor: draft?.id === m.id ? '#f1f5f9' : '#ffffff'
                    }}
                    aria-pressed={draft?.id === m.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold" style={{ color: NAVY }}>
                        {memoDisplayTitle(m)}
                      </span>
                      <span className="block truncate text-[11px]" style={{ color: MUTED }}>
                        {m.body.trim() ? m.body.replace(/\s+/g, ' ').slice(0, 60) : ' '}
                      </span>
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={m.pinned ? '고정 해제' : '고정'}
                      onClick={(e) => {
                        e.stopPropagation()
                        void togglePin(m)
                      }}
                      className="shrink-0 p-0.5"
                      style={{ color: m.pinned ? NAVY : MUTED }}
                    >
                      {m.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
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
              메모를 선택하거나 ‘새 메모’를 누르세요.
            </p>
          ) : (
            <div className="space-y-2.5">
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="제목"
                aria-label="메모 제목"
                maxLength={MEMO_TITLE_MAX + 20}
                className="w-full rounded-lg border px-3 py-2 text-[15px] font-semibold outline-none focus:border-[#0e1e3a]"
                style={{ borderColor: LINE, color: NAVY }}
              />
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="내용을 입력하세요"
                aria-label="메모 내용"
                rows={14}
                maxLength={MEMO_BODY_MAX + 500}
                className="w-full resize-y rounded-lg border px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-[#0e1e3a]"
                style={{ borderColor: LINE, color: NAVY }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px]" style={{ color: MUTED }}>
                  {draft.title.length}/{MEMO_TITLE_MAX} · {draft.body.length}/{MEMO_BODY_MAX}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-2 text-xs font-semibold"
                    style={{ borderColor: LINE, color: draft.pinned ? NAVY : MUTED }}
                  >
                    {draft.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                    {draft.pinned ? '고정됨' : '고정'}
                  </button>
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
