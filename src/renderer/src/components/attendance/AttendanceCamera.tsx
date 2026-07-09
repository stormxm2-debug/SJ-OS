import { useEffect, useRef, useState } from 'react'
import { Camera, X, MapPin, Loader2, CheckCircle2, RotateCcw, FlipHorizontal2, ImagePlus, UserRound } from 'lucide-react'
import { feeLabel, lateFeeFor } from '@renderer/services/commercial/attendanceLate'

/**
 * 출퇴근 사진 촬영 v3 — 폰 "기본 카메라 앱" 방식.
 *
 * 이전(getUserMedia 내장 카메라)은 카톡/네이버 인앱브라우저·일부 아이폰에서 차단되어
 * 촬영 버튼이 무용지물이었다. v3는 <input type="file" capture>로 폰의 진짜 카메라
 * 앱을 열므로 모든 기기에서 동작한다. 전면/후면 선택 + 촬영 후 좌우반전 토글 제공.
 *
 * 속도가 생명: 촬영 → SJ INVEST 마크·시각·좌표 스탬프(로컬, 즉시) → 바로 기록.
 * 느린 주소 변환(Nominatim)은 여기서 하지 않는다 — 호출부(매니저)가 기록 저장 후
 * 백그라운드로 채운다(reverseGeocode export). 사진·좌표는 로깅하지 않는다.
 */
export interface CapturedAttendancePhoto {
  dataUrl: string
  watermarkText: string
  coords: { lat: number; lng: number; accuracy: number } | null
  /** v3: 주소는 항상 null — 저장 후 백그라운드에서 채워진다. */
  address: string | null
  /** 지각 벌금(원) — 출근이 아닐 때/정상 출근이면 0. */
  lateFee: number
  timestamp: string
}

/** 좌표 → 한국 주소 (Nominatim). 실패/타임아웃 시 null. 백그라운드 전용. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko&zoom=18`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const j = (await res.json()) as { address?: Record<string, string> }
    const a = j.address ?? {}
    const parts = [
      a.province ?? a.state ?? a.city,
      a.city && (a.province || a.state) ? a.city : undefined,
      a.county,
      a.city_district ?? a.borough,
      a.suburb ?? a.neighbourhood ?? a.quarter,
      a.road,
      a.house_number
    ].filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i)
    const s = parts.join(' ').trim()
    return s || null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

const MAX_DIM = 1600

export default function AttendanceCamera({
  open,
  label,
  staffName,
  onCapture,
  onClose,
  onSkip
}: {
  open: boolean
  label: '출근' | '퇴근'
  staffName: string
  onCapture: (photo: CapturedAttendancePhoto) => void
  onClose: () => void
  /** 사진 없이 기록하는 탈출구 (카메라/파일 접근이 아예 불가한 기기). */
  onSkip?: () => void
}): JSX.Element | null {
  const rearInputRef = useRef<HTMLInputElement>(null)
  const frontInputRef = useRef<HTMLInputElement>(null)
  const albumInputRef = useRef<HTMLInputElement>(null)

  const [shot, setShot] = useState<ImageBitmap | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mirror, setMirror] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [geoState, setGeoState] = useState<'locating' | 'ok' | 'unavailable'>('locating')

  // 열릴 때 GPS만 미리 확보 (사진은 기본 카메라 앱이 담당)
  useEffect(() => {
    if (!open) return
    let active = true
    setShot(null)
    setPreviewUrl(null)
    setMirror(false)
    setNote(null)
    setGeo(null)
    setGeoState('locating')
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!active) return
          setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
          setGeoState('ok')
        },
        () => {
          if (active) setGeoState('unavailable')
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      )
    } else {
      setGeoState('unavailable')
    }
    return () => {
      active = false
    }
  }, [open])

  useEffect(() => {
    return () => {
      shot?.close()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFile = async (file: File | null, fromFront: boolean): Promise<void> => {
    if (!file) return
    setBusy(true)
    setNote(null)
    try {
      const bmp = await createImageBitmap(file)
      shot?.close()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setShot(bmp)
      setPreviewUrl(URL.createObjectURL(file))
      setMirror(fromFront) // 셀카는 미리보기(거울) 느낌이 자연스럽도록 기본 반전
    } catch {
      setNote('사진을 읽지 못했습니다. 다시 촬영해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /** 확정: 다운스케일 + (선택)좌우반전 + SJ INVEST 워터마크 스탬프 → 즉시 기록. */
  const confirm = (): void => {
    if (!shot) return
    const scaleDown = Math.min(1, MAX_DIM / Math.max(shot.width, shot.height))
    const w = Math.max(1, Math.round(shot.width * scaleDown))
    const h = Math.max(1, Math.round(shot.height * scaleDown))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (mirror) {
      ctx.translate(w, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(shot, 0, 0, w, h)
    if (mirror) ctx.setTransform(1, 0, 0, 1, 0, 0)

    const now = new Date()
    const timestamp = now.toISOString()
    const timeStr = now.toLocaleString('ko-KR')
    const coordStr = geo ? `${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} (±${Math.round(geo.accuracy)}m)` : ''
    const placeStr = geo ? `GPS ${coordStr}` : '위치 미확인'
    const lateFee = label === '출근' ? lateFeeFor(now) : 0
    const watermarkText = [`${staffName} · ${label}`, timeStr, placeStr, lateFee > 0 ? `지각 · 벌금 ${feeLabel(lateFee)}` : '']
      .filter(Boolean)
      .join(' · ')

    // 하단 그라데이션 띠 + 이름/시각/좌표, 좌상단 SJ INVEST 골드 배지, 지각 시 우상단 빨간 배지
    const scale = w / 1000
    const pad = Math.round(28 * scale)
    const stripH = Math.round(190 * scale)
    const grad = ctx.createLinearGradient(0, h - stripH, 0, h)
    grad.addColorStop(0, 'rgba(2,6,23,0)')
    grad.addColorStop(1, 'rgba(2,6,23,0.85)')
    ctx.fillStyle = grad
    ctx.fillRect(0, h - stripH, w, stripH)

    ctx.textBaseline = 'bottom'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = Math.round(6 * scale)

    if (coordStr) {
      ctx.fillStyle = 'rgba(226,232,240,0.85)'
      ctx.font = `${Math.round(24 * scale)}px sans-serif`
      ctx.fillText(coordStr, pad, h - pad)
    }
    ctx.fillStyle = '#e2e8f0'
    ctx.font = `${Math.round(32 * scale)}px sans-serif`
    ctx.fillText(timeStr, pad, h - pad - Math.round((coordStr ? 34 : 0) * scale))
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.round(44 * scale)}px sans-serif`
    ctx.fillText(`${staffName} · ${label}`, pad, h - pad - Math.round((coordStr ? 34 : 0) * scale) - Math.round(44 * scale))

    ctx.textBaseline = 'top'
    ctx.font = `bold ${Math.round(34 * scale)}px sans-serif`
    const brand = 'SJ INVEST'
    const bw = ctx.measureText(brand).width + Math.round(36 * scale)
    const bh = Math.round(56 * scale)
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(11,17,32,0.78)'
    ctx.beginPath()
    ctx.roundRect(pad, pad, bw, bh, Math.round(12 * scale))
    ctx.fill()
    ctx.strokeStyle = '#c6982f'
    ctx.lineWidth = Math.max(2, Math.round(3 * scale))
    ctx.stroke()
    ctx.fillStyle = '#e6c877'
    ctx.fillText(brand, pad + Math.round(18 * scale), pad + Math.round(11 * scale))

    if (lateFee > 0) {
      const lateText = `지각 · 벌금 ${feeLabel(lateFee)}`
      ctx.font = `bold ${Math.round(30 * scale)}px sans-serif`
      const lw = ctx.measureText(lateText).width + Math.round(32 * scale)
      const lh = Math.round(50 * scale)
      ctx.fillStyle = 'rgba(190,30,30,0.92)'
      ctx.beginPath()
      ctx.roundRect(w - pad - lw, pad, lw, lh, Math.round(10 * scale))
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(lateText, w - pad - lw + Math.round(16 * scale), pad + Math.round(10 * scale))
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    onCapture({ dataUrl, watermarkText, coords: geo, address: null, lateFee, timestamp })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Camera className="h-4 w-4 text-indigo-400" />
            {label} 사진
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-1 text-neutral-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 숨겨진 입력 3종 — 후면/전면 카메라, 앨범 */}
        <input ref={rearInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0] ?? null, false); e.target.value = '' }} />
        <input ref={frontInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0] ?? null, true); e.target.value = '' }} />
        <input ref={albumInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0] ?? null, false); e.target.value = '' }} />

        {!shot ? (
          <div className="flex flex-col gap-3 p-5">
            <button
              type="button"
              onClick={() => rearInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-5 text-base font-extrabold text-white shadow-lg active:brightness-110"
            >
              <Camera className="h-6 w-6" /> 후면 카메라로 촬영
            </button>
            <button
              type="button"
              onClick={() => frontInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-5 text-base font-extrabold text-white shadow-lg active:brightness-110"
            >
              <UserRound className="h-6 w-6" /> 전면(셀카)으로 촬영
            </button>
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => albumInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-white">
                <ImagePlus className="h-3.5 w-3.5" /> 앨범에서 선택
              </button>
              {onSkip ? (
                <button type="button" onClick={onSkip} className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline">
                  사진 없이 기록
                </button>
              ) : null}
            </div>
            {busy ? (
              <div className="flex items-center justify-center gap-2 text-xs text-neutral-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 사진 불러오는 중…
              </div>
            ) : null}
            {note ? <p className="text-center text-xs text-[#fca5a5]">{note}</p> : null}
          </div>
        ) : (
          <>
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-black">
              {previewUrl ? (
                <img src={previewUrl} alt="촬영 미리보기" className={['h-full w-full object-cover', mirror ? '-scale-x-100' : ''].join(' ')} />
              ) : null}
            </div>
            <div className="flex items-center gap-2 border-t border-neutral-800 bg-neutral-900 px-4 py-3">
              <button
                type="button"
                onClick={confirm}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-emerald-500/30 active:brightness-110"
              >
                <CheckCircle2 className="h-4 w-4" /> 이 사진으로 {label} 기록
              </button>
              <button
                type="button"
                onClick={() => setMirror((v) => !v)}
                aria-label="좌우반전"
                className={['inline-flex items-center gap-1 rounded-xl border px-3 py-2.5 text-xs font-bold transition', mirror ? 'border-emerald-400 text-emerald-300' : 'border-neutral-600 text-neutral-300 hover:bg-neutral-800'].join(' ')}
              >
                <FlipHorizontal2 className="h-4 w-4" /> 반전
              </button>
              <button
                type="button"
                onClick={() => {
                  shot?.close()
                  setShot(null)
                  if (previewUrl) URL.revokeObjectURL(previewUrl)
                  setPreviewUrl(null)
                }}
                aria-label="다시 촬영"
                className="inline-flex items-center rounded-xl border border-neutral-600 px-3 py-2.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {/* GPS 상태 (촬영을 막지 않음 — 주소는 기록 후 자동으로 채워짐) */}
        <div className="flex items-center gap-1.5 border-t border-neutral-800 px-4 py-2 text-[11px]">
          {geoState === 'locating' ? <Loader2 className="h-3 w-3 animate-spin text-neutral-400" /> : <MapPin className={['h-3 w-3', geoState === 'ok' ? 'text-emerald-400' : 'text-rose-400'].join(' ')} />}
          <span className={geoState === 'ok' ? 'text-emerald-300' : geoState === 'unavailable' ? 'text-rose-300' : 'text-neutral-400'}>
            {geoState === 'ok' ? `위치 확인됨 (±${Math.round(geo?.accuracy ?? 0)}m) · 주소는 기록 후 자동 입력` : geoState === 'unavailable' ? '위치 미확인 (기록은 가능)' : '위치 확인 중… (촬영은 바로 가능)'}
          </span>
        </div>
      </div>
    </div>
  )
}
