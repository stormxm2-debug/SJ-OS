import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookMarked,
  Search,
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Paperclip,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  CheckCircle2,
  FileText
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import FileDropZone from '@renderer/components/ui/FileDropZone'
import { copyText } from '@renderer/services/share/clipboard'
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_SOURCES,
  KNOWLEDGE_FILE_MAX_BYTES,
  createKnowledgePost,
  deleteKnowledgePost,
  digestKnowledge,
  isAllowedKnowledgeFile,
  knowledgeFileUrl,
  listKnowledgePosts,
  matchesKnowledgeQuery,
  type KnowledgeCategory,
  type KnowledgeDigest,
  type KnowledgePost,
  type KnowledgeSource
} from '@renderer/services/commercial/knowledgeService'

/**
 * 자료 브리핑 — 카톡방·네이버 카페에서 받은 사내 자료를 AI가 정리해 모아두는 곳.
 *
 * 관리자가 원문을 붙여넣거나 캡처/PDF를 올리면 AI가 제목·분류·요약·핵심 포인트·태그와
 * "FC가 당장 할 일"을 뽑아준다. 관리자가 확인·수정 후 저장하면 전 직원이 검색·열람한다.
 * (등록·삭제=관리자, 열람=전 직원 — 서버 RLS가 실제 경계)
 *
 * 카톡방에 흩어진 시책·개정 공지를 FC가 다시 뒤지지 않아도 되게 하는 것이 목적.
 */

const CATEGORY_STYLE: Record<KnowledgeCategory, { chip: string; dot: string }> = {
  시책: { chip: 'bg-amber-50 text-amber-700', dot: '#d97706' },
  상품개정: { chip: 'bg-indigo-50 text-indigo-700', dot: '#4f46e5' },
  인수지침: { chip: 'bg-emerald-50 text-emerald-700', dot: '#059669' },
  교육: { chip: 'bg-sky-50 text-sky-700', dot: '#0284c7' },
  공지: { chip: 'bg-rose-50 text-rose-700', dot: '#e11d48' },
  기타: { chip: 'bg-slate-50 text-slate-600', dot: '#64748b' }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

export default function KnowledgeBriefingPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)

  const [posts, setPosts] = useState<KnowledgePost[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<KnowledgeCategory | '전체'>('전체')
  const [openId, setOpenId] = useState<string | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const r = await listKnowledgePosts()
    setPosts(r.posts)
    setConfigured(r.configured)
    setLoadErr(r.ok ? '' : (r.error ?? ''))
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of posts) m.set(p.category, (m.get(p.category) ?? 0) + 1)
    return m
  }, [posts])

  const filtered = useMemo(
    () => posts.filter((p) => (cat === '전체' || p.category === cat) && matchesKnowledgeQuery(p, query)),
    [posts, cat, query]
  )

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* 히어로 */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1e3a] to-[#1b3a6b] p-5 text-white">
        <div className="flex items-center gap-2">
          <BookMarked className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-extrabold">자료 브리핑</h1>
        </div>
        {/* 다크 네이비(명시 hex) 위에서는 slate 토큰 금지 — 반전 리매핑으로 검정이 됨 */}
        <p className="mt-1 text-[13px] leading-5 text-white/70">
          카톡방·카페에 흩어진 <b className="text-[#e6c877]">시책·상품개정·인수지침</b>을 AI가 정리해 모아둡니다.
          검색 한 번으로 찾으세요.
        </p>
        {admin ? (
          <button
            type="button"
            onClick={() => setComposeOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#e6c877] px-3.5 py-2 text-[12px] font-extrabold text-[#0e1e3a] hover:brightness-105"
          >
            {composeOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {composeOpen ? '등록 닫기' : '자료 등록'}
          </button>
        ) : null}
      </div>

      {admin && composeOpen ? (
        <ComposePanel
          creatorName={session.name}
          onSaved={() => {
            setComposeOpen(false)
            void load()
          }}
        />
      ) : null}

      {!configured ? (
        <div className="rounded-xl border border-[#c6982f]/40 bg-[#fdf7ea] p-3 text-[12px] leading-5 text-slate-600">
          자료 브리핑이 아직 준비되지 않았습니다. (서버 설정 전) 준비되면 이 화면에서 바로 이용하실 수 있습니다.
        </div>
      ) : null}
      {loadErr ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[12px] font-medium text-rose-700">{loadErr}</div>
      ) : null}

      {/* 검색 + 분류 필터 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
        <label className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="보험사·상품·키워드로 검색 (예: 삼성화재 간편심사)"
            className="w-full bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기" className="text-slate-400 hover:text-slate-100">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['전체', ...KNOWLEDGE_CATEGORIES] as const).map((c) => {
            const active = cat === c
            const n = c === '전체' ? posts.length : (counts.get(c) ?? 0)
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c as KnowledgeCategory | '전체')}
                className={[
                  'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
                  active ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                ].join(' ')}
              >
                {c} {n > 0 ? <span className="opacity-70">{n}</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-white p-8 text-center">
          <BookMarked className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-[13px] font-bold text-slate-100">
            {posts.length === 0 ? '아직 등록된 자료가 없습니다' : '조건에 맞는 자료가 없습니다'}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            {posts.length === 0
              ? admin
                ? '위 [자료 등록]으로 카톡방·카페에서 받은 자료를 올려보세요.'
                : '관리자가 자료를 올리면 여기에 표시됩니다.'
              : '검색어나 분류를 바꿔보세요.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              open={openId === p.id}
              admin={admin}
              onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
              onDeleted={() => void load()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- 목록 카드 */

function PostCard({
  post,
  open,
  admin,
  onToggle,
  onDeleted
}: {
  post: KnowledgePost
  open: boolean
  admin: boolean
  onToggle: () => void
  onDeleted: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const style = CATEGORY_STYLE[post.category]

  const openFile = async (): Promise<void> => {
    if (!post.filePath) return
    setMsg('')
    const r = await knowledgeFileUrl(post.filePath)
    if (!r.ok || !r.url) {
      setMsg(r.error ?? '파일을 열지 못했습니다.')
      return
    }
    window.open(r.url, '_blank', 'noopener')
  }

  const share = async (): Promise<void> => {
    const lines = [
      `[${post.category}] ${post.title}`,
      post.summary ?? '',
      ...(post.keyPoints.length ? ['', ...post.keyPoints.map((k) => `· ${k}`)] : []),
      ...(post.actionForFc ? ['', `▶ ${post.actionForFc}`] : [])
    ].filter(Boolean)
    const ok = await copyText(lines.join('\n'))
    setMsg(ok ? '복사했습니다. 카톡에 붙여넣으세요.' : '복사하지 못했습니다. 길게 눌러 복사해주세요.')
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm('이 자료를 삭제할까요?')) return
    setBusy(true)
    const r = await deleteKnowledgePost(post.id)
    setBusy(false)
    if (!r.ok) {
      setMsg(r.error ?? '삭제 실패')
      return
    }
    onDeleted()
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-3.5 shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2.5 text-left">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: style.dot }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={['rounded-full px-2 py-0.5 text-[10px] font-extrabold', style.chip].join(' ')}>
              {post.category}
            </span>
            {post.filePath ? <Paperclip className="h-3 w-3 text-slate-400" /> : null}
            <span className="text-[10px] text-slate-500">
              {fmtDate(post.createdAt)} · {post.creatorName}
            </span>
          </span>
          <span className="mt-1 block text-[13px] font-extrabold leading-5 text-slate-100">{post.title}</span>
          {!open && post.summary ? (
            <span className="mt-0.5 block truncate text-[12px] text-slate-500">{post.summary}</span>
          ) : null}
        </span>
        {open ? (
          <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
          {post.summary ? <p className="text-[12.5px] leading-6 text-slate-600">{post.summary}</p> : null}

          {post.keyPoints.length > 0 ? (
            <ul className="space-y-1.5">
              {post.keyPoints.map((k, i) => (
                <li key={`${post.id}-kp-${i}`} className="flex gap-2 text-[12.5px] leading-5 text-slate-600">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b0821f]" />
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {post.actionForFc ? (
            <div className="rounded-xl border border-[#c6982f]/40 bg-[#fdf7ea] p-2.5">
              <div className="text-[10px] font-extrabold text-[#b0821f]">지금 할 일</div>
              <div className="mt-0.5 text-[12.5px] font-semibold leading-5 text-slate-700">{post.actionForFc}</div>
            </div>
          ) : null}

          {post.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {post.tags.map((t, i) => (
                <span key={`${post.id}-tag-${i}`} className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  #{t}
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            {post.filePath ? (
              <button
                type="button"
                onClick={() => void openFile()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:text-slate-100"
              >
                <FileText className="h-3.5 w-3.5" /> 원본 보기
              </button>
            ) : null}
            {post.sourceUrl ? (
              <a
                href={post.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:text-slate-100"
              >
                <ExternalLink className="h-3.5 w-3.5" /> 출처 열기
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => void share()}
              className="inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-2.5 py-1.5 text-[11px] font-extrabold text-[#e6c877]"
            >
              카톡용 복사
            </button>
            {admin ? (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-400 hover:text-rose-600"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} 삭제
              </button>
            ) : null}
          </div>

          {post.bodyText ? (
            <details className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
              <summary className="cursor-pointer text-[11px] font-bold text-slate-500">원문 보기</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-[11.5px] leading-5 text-slate-600">{post.bodyText}</pre>
            </details>
          ) : null}

          {msg ? <div className="text-[11px] font-medium text-[#b0821f]">{msg}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- 관리자 등록 */

function ComposePanel({ creatorName, onSaved }: { creatorName: string; onSaved: () => void }): JSX.Element {
  const [source, setSource] = useState<KnowledgeSource>('kakao')
  const [sourceUrl, setSourceUrl] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [titleHint, setTitleHint] = useState('')
  const [digest, setDigest] = useState<KnowledgeDigest | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const pickFile = (f: File | null): void => {
    setMsg('')
    if (!f) {
      setFile(null)
      return
    }
    if (!isAllowedKnowledgeFile(f)) {
      setMsg('이미지(캡처) 또는 PDF만 올릴 수 있습니다.')
      return
    }
    if (f.size > KNOWLEDGE_FILE_MAX_BYTES) {
      setMsg('파일이 너무 큽니다. 8MB 이하로 올려주세요.')
      return
    }
    setFile(f)
  }

  const runDigest = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await digestKnowledge({
      titleHint,
      bodyText,
      file,
      sourceHint: KNOWLEDGE_SOURCES.find((s) => s.key === source)?.label
    })
    setBusy(false)
    if (!r.ok || !r.digest) {
      setMsg(r.error ?? 'AI 정리에 실패했습니다.')
      return
    }
    setDigest(r.digest)
  }

  const save = async (): Promise<void> => {
    if (!digest) return
    setBusy(true)
    setMsg('')
    const r = await createKnowledgePost({ digest, source, sourceUrl, bodyText, file, creatorName })
    setBusy(false)
    if (!r.ok) {
      setMsg(r.error ?? '저장에 실패했습니다.')
      return
    }
    onSaved()
  }

  const canDigest = Boolean(bodyText.trim() || file)

  return (
    <div className="rounded-2xl border border-[#c6982f]/40 bg-white p-4 shadow-sm">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
        <Sparkles className="h-4 w-4 text-[#b0821f]" /> 자료 등록 (AI 정리)
      </h2>

      {/* 출처 */}
      <div className="flex flex-wrap gap-1.5">
        {KNOWLEDGE_SOURCES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSource(s.key)}
            className={[
              'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
              source === s.key ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            ].join(' ')}
          >
            {s.label}
          </button>
        ))}
      </div>

      <label className="mt-2.5 block">
        <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">자료 원문 붙여넣기</span>
        <textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={5}
          placeholder="카톡방에서 복사한 내용을 그대로 붙여넣으세요."
          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-[12.5px] leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
        />
      </label>

      {/* 파일 (캡처·PDF) */}
      <div className="mt-2">
        <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">또는 캡처·PDF 올리기 (선택)</span>
        <FileDropZone onFiles={(files) => pickFile(files[0] ?? null)} accept="image/*,application/pdf">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-800 bg-slate-950 px-3 py-3 text-[12px] font-semibold text-slate-500 hover:text-slate-100"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {file ? file.name : '파일 선택 또는 여기로 끌어놓기 (이미지·PDF, 8MB 이하)'}
          </button>
        </FileDropZone>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <button
            type="button"
            onClick={() => setFile(null)}
            className="mt-1 text-[11px] font-semibold text-slate-500 hover:text-rose-600"
          >
            첨부 취소
          </button>
        ) : null}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">제목 힌트 (선택)</span>
          <input
            value={titleHint}
            onChange={(e) => setTitleHint(e.target.value)}
            placeholder="예: 삼성화재 8월 시책"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">출처 링크 (선택)</span>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="카페 글 주소 등"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void runDigest()}
        disabled={busy || !canDigest}
        className={[
          'mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[13px] font-extrabold',
          busy || !canDigest
            ? 'cursor-not-allowed bg-slate-200 text-slate-400'
            : 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877]'
        ].join(' ')}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {digest ? 'AI 다시 정리' : 'AI로 정리하기'}
      </button>

      {msg ? <div className="mt-2 text-[11.5px] font-medium text-rose-600">{msg}</div> : null}

      {/* AI 결과 미리보기 — 저장 전에 관리자가 고칠 수 있다 */}
      {digest ? (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <div className="text-[10px] font-extrabold text-[#b0821f]">AI 정리 결과 — 확인 후 저장하세요</div>
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">제목</span>
            <input
              value={digest.title}
              onChange={(e) => setDigest({ ...digest, title: e.target.value })}
              className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[12.5px] font-bold text-slate-100 outline-none focus:border-[#c6982f]"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDigest({ ...digest, category: c })}
                className={[
                  'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
                  digest.category === c ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-600 hover:bg-slate-100'
                ].join(' ')}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">요약</span>
            <textarea
              value={digest.summary}
              onChange={(e) => setDigest({ ...digest, summary: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[12.5px] leading-5 text-slate-100 outline-none focus:border-[#c6982f]"
            />
          </label>
          {digest.keyPoints.length > 0 ? (
            <div>
              <span className="mb-1 block text-[10px] font-semibold text-slate-500">핵심 포인트</span>
              <ul className="space-y-1">
                {digest.keyPoints.map((k, i) => (
                  <li key={`kp-${i}`} className="flex gap-2 text-[12px] leading-5 text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b0821f]" />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {digest.actionForFc ? (
            <div className="rounded-lg border border-[#c6982f]/40 bg-[#fdf7ea] p-2 text-[12px] font-semibold text-slate-700">
              지금 할 일: {digest.actionForFc}
            </div>
          ) : null}
          {digest.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {digest.tags.map((t, i) => (
                <span key={`t-${i}`} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  #{t}
                </span>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !digest.title.trim()}
            className={[
              'mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[13px] font-extrabold',
              busy || !digest.title.trim()
                ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                : 'bg-[#e6c877] text-[#0e1e3a] hover:brightness-105'
            ].join(' ')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 전 직원에게 공유
          </button>
        </div>
      ) : null}
    </div>
  )
}
