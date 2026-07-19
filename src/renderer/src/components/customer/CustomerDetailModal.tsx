import { useEffect, useRef, useState } from 'react'
import { UserRound, X, Phone, Pencil, Paperclip, FileText, Image as ImageIcon, ExternalLink, Mic, MessageSquare, Send, Loader2, ImagePlus } from 'lucide-react'
import type { CustomerRecord } from '@shared/commercial/models'
import { signedUrlsFor } from '@renderer/services/commercial/customerFilesStorage'
import { parseRrn, bmiOf } from '@renderer/services/commercial/customerValidation'
import { sendCustomerMms } from '@renderer/services/commercial/mmsService'

/**
 * 고객 상세 보기 모달 — 고객명을 누르면 뜬다(읽기 전용, 깔끔 정리).
 * 이미 로드된 CustomerRecord 를 그대로 받아 표시하고, 첨부 서류만 서명 URL 로 연다.
 * onEdit 를 주면 [수정] 버튼으로 기존 편집 폼으로 넘어간다.
 */
export default function CustomerDetailModal({
  customer,
  onClose,
  onEdit
}: {
  customer: CustomerRecord
  onClose: () => void
  onEdit?: () => void
}): JSX.Element {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [mmsOpen, setMmsOpen] = useState(false)

  useEffect(() => {
    let alive = true
    if (customer.attachments.length > 0) {
      void signedUrlsFor(customer.attachments).then((m) => {
        if (alive) setUrls(m)
      })
    }
    return () => {
      alive = false
    }
  }, [customer])

  const rrn = parseRrn(customer.rrn)
  const bmi = bmiOf(customer.heightCm, customer.weightKg)
  const heightWeight =
    customer.heightCm || customer.weightKg
      ? `${customer.heightCm ?? '-'}cm / ${customer.weightKg ?? '-'}kg${bmi ? ` (BMI ${bmi})` : ''}`
      : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-800 bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
            <UserRound className="h-4 w-4 text-[#b0821f]" /> 고객 상세
          </h3>
          <div className="flex items-center gap-1.5">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1 text-[12px] font-bold text-[#b0821f] hover:bg-slate-950"
              >
                <Pencil className="h-3.5 w-3.5" /> 수정
              </button>
            ) : null}
            <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:text-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 이름 배너 + 전화 */}
        <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0e1e3a] px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-base font-extrabold text-white">{customer.name}</div>
            <div className="mt-0.5 text-[12px] text-slate-300">
              {customer.phone || '전화 없음'}
              {rrn ? <span className="ml-2">· 만 {rrn.age}세 · {rrn.gender}</span> : null}
            </div>
          </div>
          {customer.phone ? (
            <div className="flex shrink-0 flex-col gap-1.5">
              <a
                href={`tel:${customer.phone}`}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#c6982f] px-3 py-1.5 text-[12px] font-bold text-[#201603]"
              >
                <Phone className="h-3.5 w-3.5" /> 전화
              </a>
              <button
                type="button"
                onClick={() => setMmsOpen((v) => !v)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#c6982f]/50 bg-white/10 px-3 py-1.5 text-[12px] font-bold text-[#e6c877]"
              >
                <MessageSquare className="h-3.5 w-3.5" /> 사진 문자
              </button>
            </div>
          ) : null}
        </div>

        {/* 사진 문자(MMS) 작성 — 고객에게 텍스트+사진 발송 */}
        {mmsOpen && customer.phone ? <MmsCompose customer={customer} onClose={() => setMmsOpen(false)} /> : null}

        {/* 정보 그리드 */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="주민번호" value={customer.rrn} />
          <Field label="생년월일" value={rrn?.birthDate ?? customer.birthDate} />
          <Field label="유입경로" value={customer.source} />
          <Field label="관계" value={customer.relation} />
          <Field label="키/몸무게" value={heightWeight} />
          <Field label="등록일" value={new Date(customer.createdAt).toLocaleDateString('ko-KR')} />
        </div>
        <Field label="주소" value={customer.address} wide />
        <Field label="병력" value={customer.medicalHistory} wide />
        <Field label="메모" value={customer.memo} wide />

        {customer.registeredInsurers.length > 0 ? (
          <div className="mt-2">
            <div className="mb-1 text-[11px] font-semibold text-slate-500">등록 보험사</div>
            <div className="flex flex-wrap gap-1.5">
              {customer.registeredInsurers.map((n) => (
                <span key={n} className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                  {n}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* 첨부 서류 · 음성 */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <Paperclip className="h-3 w-3" /> 첨부 {customer.attachments.length}건
          </div>
          {customer.attachments.length === 0 ? (
            <p className="text-[12px] text-slate-500">첨부된 서류가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {customer.attachments.filter((a) => a.kind !== 'audio').map((a) => {
                const url = urls.get(a.path)
                return (
                  <a
                    key={a.path}
                    href={url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className={[
                      'group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-center',
                      url ? 'cursor-pointer hover:border-[#c6982f]' : 'cursor-not-allowed opacity-60'
                    ].join(' ')}
                  >
                    {a.kind === 'image' && url ? (
                      <img src={url} alt={a.name} className="h-full w-full object-cover" />
                    ) : a.kind === 'image' ? (
                      <ImageIcon className="h-6 w-6 text-slate-400" />
                    ) : (
                      <FileText className="h-6 w-6 text-slate-400" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 truncate bg-black/60 px-1 py-0.5 text-[9px] text-white">
                      {url ? <ExternalLink className="h-2.5 w-2.5" /> : null}
                      {a.kind === 'pdf' ? 'PDF' : truncate(a.name, 8)}
                    </span>
                  </a>
                )
              })}
            </div>
          )}
          {/* 음성 녹취 — 인라인 재생 (민원 대응 시 바로 확인) */}
          {customer.attachments.some((a) => a.kind === 'audio') ? (
            <div className="mt-2 space-y-1.5">
              {customer.attachments.filter((a) => a.kind === 'audio').map((a) => {
                const url = urls.get(a.path)
                return (
                  <div key={a.path} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="inline-flex items-center gap-1 truncate text-[11px] font-semibold text-slate-100">
                        <Mic className="h-3 w-3 shrink-0 text-[#b0821f]" /> {a.name}
                      </span>
                      {a.uploadedAt ? (
                        <span className="text-[10px] text-slate-500">{new Date(a.uploadedAt).toLocaleString('ko-KR')} 업로드</span>
                      ) : null}
                    </div>
                    {url ? (
                      <audio controls preload="none" src={url} className="mt-1.5 h-8 w-full" />
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">재생 URL을 불러오는 중…</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, wide }: { label: string; value?: string; wide?: boolean }): JSX.Element {
  return (
    <div className={['rounded-xl border border-slate-800 bg-slate-950 px-3 py-2', wide ? 'col-span-2 mt-2' : ''].join(' ')}>
      <div className="text-[10px] font-semibold text-slate-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-[12px] font-medium text-slate-100">{value?.trim() ? value : '-'}</div>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** 고객에게 사진 문자(MMS) 보내기 — 사진(자동압축)+텍스트를 문자로 발송. */
function MmsCompose({ customer, onClose }: { customer: CustomerRecord; onClose: () => void }): JSX.Element {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const send = async (): Promise<void> => {
    if (!file) {
      setMsg({ ok: false, text: '사진을 첨부해주세요.' })
      return
    }
    setSending(true)
    setMsg(null)
    const r = await sendCustomerMms({ customerId: customer.id, text, imageFile: file, subject: 'SJ INVEST' })
    setSending(false)
    if (r.code === 'NOT_CONFIGURED') {
      setMsg({ ok: false, text: '사진 문자(MMS)가 아직 설정되지 않았습니다. 관리자에게 문의하세요.' })
      return
    }
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? '발송 실패' })
      return
    }
    setMsg({ ok: true, text: `${customer.name} 님에게 사진 문자를 보냈습니다.` })
    setText('')
    setFile(null)
  }

  return (
    <div className="mt-2 rounded-xl border border-[#c6982f]/40 bg-white p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold text-slate-100">
        <MessageSquare className="h-3.5 w-3.5 text-[#b0821f]" /> 사진 문자 보내기 <span className="font-normal text-slate-500">→ {customer.phone}</span>
      </div>

      {/* 사진 선택/미리보기 */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {preview ? (
        <div className="relative mb-2 overflow-hidden rounded-lg border border-slate-800">
          <img src={preview} alt="첨부" className="max-h-48 w-full object-contain bg-slate-950" />
          <button type="button" onClick={() => setFile(null)} aria-label="사진 제거" className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 bg-slate-950 py-4 text-[12px] font-semibold text-slate-400"
        >
          <ImagePlus className="h-4 w-4" /> 사진 선택 / 촬영
        </button>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="보낼 메시지를 입력하세요"
        className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-[13px] leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
      />

      <label className="mt-2 flex items-start gap-2 text-[11px] leading-4 text-slate-500">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[#c6982f]" />
        고객이 문자 수신에 동의했으며, 발송 내용에 문제가 없음을 확인합니다. (MMS는 건당 유료·사진은 자동 압축되어 발송됩니다)
      </label>

      {msg ? <div className={['mt-2 text-[12px] font-medium', msg.ok ? 'text-emerald-600' : 'text-rose-600'].join(' ')}>{msg.text}</div> : null}

      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-100">
          닫기
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !file || !text.trim() || !consent}
          className={['inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-extrabold', sending || !file || !text.trim() || !consent ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877]'].join(' ')}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} 사진 문자 보내기
        </button>
      </div>
    </div>
  )
}
