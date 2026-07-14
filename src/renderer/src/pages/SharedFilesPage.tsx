import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  UploadCloud,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  PenLine,
  RotateCcw,
  ShieldAlert,
  Archive
} from 'lucide-react'
// PDF 편집기는 열 때만 내려받는다 — pdf-lib/폰트가 메인 번들에 실리지 않게 (첫 로딩 속도)
const PdfFillEditor = lazy(() => import('@renderer/components/files/PdfFillEditor'))
import Card from '@renderer/components/ui/Card'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import {
  listSharedFiles,
  uploadSharedFile,
  deleteSharedFile,
  softDeleteFile,
  restoreFile,
  sharedFileUrl,
  formatFileSize,
  extOf,
  type SharedFileItem,
  type SharedFileScope,
  type SharedFileView
} from '@renderer/services/commercial/sharedFilesService'

/**
 * 자료실 — 공유 자료(전직원 열람 · 관리자 업로드) + 내 파일(본인만) 두 칸.
 * 컴퓨터에서 드래그&드롭으로 올리면 폰 앱에서 바로 열람(서명 URL).
 * PDF·이미지는 브라우저에서 바로 열리고, 엑셀·워드·한글은 다운로드된다.
 */

function iconFor(name: string): JSX.Element {
  const ext = extOf(name)
  if (ext === 'pdf' || ext === 'doc' || ext === 'docx' || ext === 'hwp' || ext === 'txt') return <FileText className="h-4 w-4 text-rose-500" />
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'heic') return <ImageIcon className="h-4 w-4 text-indigo-500" />
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
  return <FileIcon className="h-4 w-4 text-slate-400" />
}

export default function SharedFilesPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)

  const [scope, setScope] = useState<SharedFileScope>('company')
  const [personalView, setPersonalView] = useState<SharedFileView>('active') // 대표 전용: 활성/삭제됨(보관)
  const [items, setItems] = useState<SharedFileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [notes, setNotes] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // PDF 채우기 편집기 (자료실 파일 또는 기기에서 고른 PDF)
  const [editing, setEditing] = useState<{ name: string; data: ArrayBuffer } | null>(null)
  const [fillLoading, setFillLoading] = useState<string | null>(null)
  const pdfPickRef = useRef<HTMLInputElement>(null)

  // 대표가 개인함의 '삭제됨(보관)'을 보는 중 = 보관함 뷰 (업로드/소프트삭제 없음)
  const isArchive = scope === 'personal' && admin && personalView === 'deleted'
  const canUpload = scope === 'company' ? admin : !isArchive

  const load = useCallback(
    async (s: SharedFileScope = scope, v: SharedFileView = personalView): Promise<void> => {
      setLoading(true)
      const res = await listSharedFiles(s, s === 'personal' ? v : 'active')
      setItems(res.items)
      setError(res.ok ? undefined : res.error)
      setLoading(false)
    },
    [scope, personalView]
  )

  useEffect(() => {
    void load(scope, personalView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, personalView])

  const handleFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0 || !canUpload) return
    setUploading(true)
    setNotes([])
    const errs: string[] = []
    for (const f of files) {
      const res = await uploadSharedFile(f, scope, session.name || '직원')
      if (!res.ok && res.error) errs.push(res.error)
    }
    setUploading(false)
    setNotes(errs)
    void load(scope)
  }

  const open = async (item: SharedFileItem): Promise<void> => {
    setOpening(item.id)
    const res = await sharedFileUrl(item)
    setOpening(null)
    if (!res.ok || !res.url) {
      setNotes([res.error ?? '파일을 열지 못했습니다.'])
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  const remove = async (item: SharedFileItem): Promise<void> => {
    if (item.scope === 'company') {
      // 공유 자료: 관리자 영구삭제 (되돌릴 수 없음)
      if (typeof window !== 'undefined' && !window.confirm(`"${item.name}" 파일을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return
      const res = await deleteSharedFile(item)
      if (!res.ok) return setNotes([res.error ?? '삭제에 실패했습니다.'])
      return void load()
    }
    // 개인 파일: 소프트삭제 (서버 보존 — 대표는 '삭제됨'에서 복원 가능)
    if (typeof window !== 'undefined' && !window.confirm(`"${item.name}" 파일을 삭제할까요?\n(서버에는 보관되며, 대표는 '삭제됨'에서 복원할 수 있어요)`)) return
    const res = await softDeleteFile(item, admin)
    if (!res.ok) return setNotes([res.error ?? '삭제에 실패했습니다.'])
    void load()
  }

  const doRestore = async (item: SharedFileItem): Promise<void> => {
    const res = await restoreFile(item)
    if (!res.ok) return setNotes([res.error ?? '복원에 실패했습니다.'])
    void load()
  }

  const doPurge = async (item: SharedFileItem): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`"${item.name}" 파일을 영구삭제할까요?\n서버에서도 완전히 사라지며 되돌릴 수 없습니다.`)) return
    const res = await deleteSharedFile(item)
    if (!res.ok) return setNotes([res.error ?? '영구삭제에 실패했습니다.'])
    void load()
  }

  // 활성 뷰에서만 삭제 버튼: 개인=본인 or 대표 / 공유=관리자.
  const canDelete = (item: SharedFileItem): boolean =>
    item.scope === 'company' ? admin : item.ownerId === session.id || admin

  /** 자료실 PDF → 바이트 내려받아 채우기 편집기 열기. */
  const openFill = async (item: SharedFileItem): Promise<void> => {
    setFillLoading(item.id)
    setNotes([])
    try {
      const res = await sharedFileUrl(item)
      if (!res.ok || !res.url) throw new Error(res.error)
      const bin = await fetch(res.url)
      if (!bin.ok) throw new Error('download')
      setEditing({ name: item.name, data: await bin.arrayBuffer() })
    } catch {
      setNotes(['PDF를 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.'])
    } finally {
      setFillLoading(null)
    }
  }

  /** 기기(폰/PC)에서 PDF를 직접 골라 채우기 — 자료실에 없어도 사용 가능. */
  const pickLocalPdf = async (f: File | null): Promise<void> => {
    if (!f) return
    if (extOf(f.name) !== 'pdf') {
      setNotes(['PDF 파일만 채우기를 지원합니다.'])
      return
    }
    setEditing({ name: f.name, data: await f.arrayBuffer() })
  }

  return (
    <div className="space-y-4">
      <Card
        title="자료실"
        icon={<FolderOpen className="h-4 w-4 text-indigo-600" />}
        action={
          <button
            type="button"
            onClick={() => void load(scope)}
            aria-label="새로고침"
            className="rounded-lg border border-slate-800 bg-white p-2 text-slate-400 transition hover:text-slate-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      >
        <p className="text-[12px] leading-5 text-slate-500">
          컴퓨터에서 파일을 올리면 폰 앱에서 바로 열 수 있습니다. PDF·사진은 바로 열리고, 엑셀·워드·한글 파일은 다운로드됩니다.
        </p>

        {/* PDF 양식 채우기 — 자료실 PDF의 [채우기] 또는 기기에서 직접 선택 */}
        <button
          type="button"
          onClick={() => pdfPickRef.current?.click()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#c6982f] bg-[#fdf7ea] px-3 py-2 text-xs font-bold text-[#8a6a1f] transition hover:brightness-95"
        >
          <PenLine className="h-3.5 w-3.5" /> 기기에서 PDF 열어 채우기
        </button>
        <input
          ref={pdfPickRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            void pickLocalPdf(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />

        {/* 공유 자료 ↔ 내 파일 (내것/직원것 분리 원칙과 동일한 두 칸 구조) */}
        <div className="mt-3 flex overflow-hidden rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setScope('company')
              setPersonalView('active')
            }}
            className={['flex-1 px-3 py-2 text-xs font-bold transition', scope === 'company' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
          >
            공유 자료
          </button>
          <button
            type="button"
            onClick={() => {
              setScope('personal')
              setPersonalView('active')
            }}
            className={['flex-1 px-3 py-2 text-xs font-bold transition', scope === 'personal' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}
          >
            {admin ? '회원 파일' : '내 파일'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          {scope === 'company'
            ? '전 직원이 볼 수 있는 회사 자료입니다 · 업로드/삭제는 대표·관리자만'
            : admin
              ? '전 회원의 개인 파일입니다 · 열람·관리 가능 · 삭제는 서버에 보관되어 복원할 수 있어요'
              : '내 개인 보관함입니다 · 나만 올리고 관리해요 (회사 규정상 대표는 열람·관리할 수 있어요)'}
        </p>

        {/* 대표 전용: 활성 ↔ 삭제됨(보관) 전환 */}
        {scope === 'personal' && admin ? (
          <div className="mt-2 flex overflow-hidden rounded-lg border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setPersonalView('active')}
              className={['flex-1 px-2 py-1.5 font-bold transition', personalView === 'active' ? 'bg-slate-800 text-slate-100' : 'bg-white text-slate-500'].join(' ')}
            >
              정상 파일
            </button>
            <button
              type="button"
              onClick={() => setPersonalView('deleted')}
              className={['flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 font-bold transition', personalView === 'deleted' ? 'bg-rose-900/40 text-rose-200' : 'bg-white text-slate-500'].join(' ')}
            >
              <Archive className="h-3 w-3" /> 삭제됨 (보관)
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        ) : null}
        {notes.map((n) => (
          <div key={n} className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {n}
          </div>
        ))}

        {/* 업로드 존 */}
        {canUpload ? (
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
              void handleFiles(Array.from(e.dataTransfer.files ?? []))
            }}
            className={[
              'mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-6 py-6 text-center transition',
              dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-700 bg-slate-950 hover:border-indigo-400 hover:bg-indigo-50/40'
            ].join(' ')}
          >
            {uploading ? <Loader2 className="h-7 w-7 animate-spin text-indigo-600" /> : <UploadCloud className={['h-7 w-7', dragOver ? 'text-indigo-600' : 'text-slate-500'].join(' ')} />}
            <div className="text-sm font-semibold text-slate-100">
              {uploading ? '업로드 중…' : (
                <>
                  파일을 드래그하거나 <span className="text-indigo-600">클릭해서 선택</span>
                </>
              )}
            </div>
            <div className="text-[11px] text-slate-500">PDF · 사진 · 엑셀 · 워드 · 한글 등 (파일당 최대 20MB, 여러 개 가능)</div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-slate-700 bg-white/50 px-3 py-2.5 text-center text-[11px] text-slate-500">
            {isArchive
              ? '삭제되어 보관 중인 파일입니다. 복원하거나 영구삭제할 수 있어요.'
              : '공유 자료 업로드는 대표·관리자만 가능합니다 — 개인 파일은 [내 파일] 탭에 올려주세요'}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.hwp,.txt,.csv"
          className="hidden"
          onChange={(e) => {
            void handleFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />

        {/* 파일 목록 */}
        <div className="mt-3 space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 파일 목록을 불러오는 중…
            </div>
          ) : items.length === 0 && !error ? (
            <div className="rounded-xl border border-dashed border-slate-700 py-6 text-center text-[12px] text-slate-500">
              {isArchive
                ? '삭제되어 보관 중인 파일이 없습니다.'
                : scope === 'company'
                  ? '아직 공유 자료가 없습니다.'
                  : admin
                    ? '아직 회원이 올린 개인 파일이 없습니다.'
                    : '아직 올린 파일이 없습니다.'}
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className={['flex items-center gap-2.5 rounded-xl border px-3 py-2.5', isArchive ? 'border-rose-200 bg-rose-50/50' : 'border-slate-800 bg-white'].join(' ')}>
                <span className="shrink-0">{iconFor(item.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-100">{item.name}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                    <span>{formatFileSize(item.sizeBytes)}</span>
                    <span>{item.createdAt ? new Date(item.createdAt).toLocaleDateString('ko-KR') : ''}</span>
                    {/* 소유 회원 (공유 자료 + 대표가 보는 개인 파일) */}
                    {(scope === 'company' || admin) && item.ownerName ? (
                      <span className="rounded-full bg-slate-950 px-1.5 py-0.5 font-semibold text-slate-400">{item.ownerName}</span>
                    ) : null}
                    {/* 삭제 보관: 누가 지웠는지 */}
                    {item.deletedAt ? (
                      <span className="rounded-full bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-600">
                        {item.deletedByRole === 'owner' ? '대표가 삭제' : '회원이 삭제'}
                        {` · ${new Date(item.deletedAt).toLocaleDateString('ko-KR')}`}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void open(item)}
                  disabled={opening === item.id}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                >
                  {opening === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />} 열기
                </button>
                {!isArchive && extOf(item.name) === 'pdf' ? (
                  <button
                    type="button"
                    onClick={() => void openFill(item)}
                    disabled={fillLoading === item.id}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#c6982f] bg-[#fdf7ea] px-2.5 py-1.5 text-[11px] font-bold text-[#8a6a1f] disabled:opacity-60"
                  >
                    {fillLoading === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3" />} 채우기
                  </button>
                ) : null}
                {isArchive ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void doRestore(item)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-50"
                    >
                      <RotateCcw className="h-3 w-3" /> 복원
                    </button>
                    <button
                      type="button"
                      onClick={() => void doPurge(item)}
                      aria-label={`${item.name} 영구삭제`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-300 bg-white px-2 py-1.5 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50"
                    >
                      <ShieldAlert className="h-3 w-3" /> 영구삭제
                    </button>
                  </>
                ) : canDelete(item) ? (
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    aria-label={`${item.name} 삭제`}
                    className="shrink-0 rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 transition hover:border-rose-300 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* PDF 채우기 편집기 (풀스크린 오버레이, 지연 로드) */}
      {editing ? (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 text-sm text-slate-300">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 편집기를 여는 중…
            </div>
          }
        >
          <PdfFillEditor
            fileName={editing.name}
            data={editing.data}
            onClose={() => setEditing(null)}
            onSaved={() => {
              if (scope === 'personal') void load('personal')
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
