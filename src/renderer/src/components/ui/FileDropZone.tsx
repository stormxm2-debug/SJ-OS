import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { UploadCloud } from 'lucide-react'

/**
 * 파일 드래그&드롭 공용 래퍼 — 클릭 업로드만 있던 영역을 감싸면 드롭이 된다.
 *
 * - dragenter/leave 깊이 카운터로 자식 위를 지날 때 하이라이트가 깜빡이지 않는다.
 * - accept 문자열('image/*,application/pdf,.xlsx' 형식)로 드롭 파일을 필터하고,
 *   multiple=false면 첫 파일만 전달한다.
 * - 파일이 아닌 드래그(텍스트 선택 등)에는 반응하지 않는다.
 * - 창 밖 드롭으로 브라우저가 파일을 열어버리는 문제는 App의 전역 가드가 막는다
 *   (이 컴포넌트는 존 내부 드롭만 담당).
 */

interface FileDropZoneProps {
  onFiles: (files: File[]) => void
  /** input accept와 동일 문법: 'image/*,application/pdf,.xlsx' */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  className?: string
  /** 하이라이트 오버레이에 보여줄 문구 (기본: 여기에 놓으면 업로드됩니다). */
  dropLabel?: string
  children: ReactNode
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/** accept 규칙 하나('image/*' | 'application/pdf' | '.xlsx')에 파일이 맞는지. */
function matchesRule(file: File, rule: string): boolean {
  const r = rule.trim().toLowerCase()
  if (!r) return false
  if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r)
  if (r.endsWith('/*')) return file.type.toLowerCase().startsWith(r.slice(0, -1))
  return file.type.toLowerCase() === r
}

export function filterByAccept(files: File[], accept?: string): File[] {
  if (!accept?.trim()) return files
  const rules = accept.split(',')
  return files.filter((f) => rules.some((r) => matchesRule(f, r)))
}

export default function FileDropZone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  className,
  dropLabel = '여기에 놓으면 업로드됩니다',
  children
}: FileDropZoneProps): JSX.Element {
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  const onDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current += 1
    setActive(true)
  }
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setActive(false)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current = 0
    setActive(false)
    const dropped = Array.from(e.dataTransfer?.files ?? [])
    const accepted = filterByAccept(dropped, accept)
    if (accepted.length === 0) return
    onFiles(multiple ? accepted : accepted.slice(0, 1))
  }

  return (
    <div
      className={['relative', className ?? ''].join(' ')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {active ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#c6982f]"
          style={{ background: 'rgba(14,30,58,0.82)' }}
        >
          <div className="flex items-center gap-2 text-sm font-bold text-[#e6c877]">
            <UploadCloud className="h-5 w-5" />
            {dropLabel}
          </div>
        </div>
      ) : null}
    </div>
  )
}
