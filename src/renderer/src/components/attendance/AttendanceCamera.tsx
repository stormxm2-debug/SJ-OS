import { useEffect, useRef, useState } from 'react'
import { Camera, X, MapPin, Loader2 } from 'lucide-react'
import { feeLabel, lateFeeFor } from '@renderer/services/commercial/attendanceLate'

/**
 * 출퇴근 사진 촬영 v4 — 후면 카메라 전용 + 즉시 기록.
 *
 * v3에서 바뀐 점 (대표 지시):
 * - 전면(셀카)/앨범 선택 제거 — 후면 카메라 촬영만 가능.
 * - 촬영 후 미리보기·확인 단계 제거 — 폰 카메라 앱에 이미 확인/재촬영이 있으므로,
 *   돌아오는 즉시 스탬프를 찍고 자동 기록한다 ("찍고 나면 사진이 안 보임" 문제의
 *   원인이던 중간 확인 화면 자체를 없앰 + 속도 최우선).
 * - 고화소(1억 화소급) 사진의 createImageBitmap 메모리 실패 대비: <img> 디코드 후
 *   즉시 다운스케일 캔버스로 옮긴다.
 * - GPS 주소를 모달에서 미리 조회(백그라운드)해 두고, 기록 시점에 준비돼 있으면
 *   워터마크와 기록에 바로 넣는다. 늦으면 기존대로 저장 후 백그라운드로 채운다.
 */
export interface CapturedAttendancePhoto {
  dataUrl: string
  watermarkText: string
  coords: { lat: number; lng: number; accuracy: number } | null
  /** 모달에서 미리 확보되면 채워짐 — 없으면 저장 후 백그라운드에서 채운다. */
  address: string | null
  /** 지각 벌금(원) — 출근이 아닐 때/정상 출근이면 0. */
  lateFee: number
  timestamp: string
}

/** 좌표 → 한국 주소 (Nominatim). 실패/타임아웃 시 null. */
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

/** 파일 → 다운스케일된 캔버스. <img> 디코드라 초고화소/EXIF 회전에도 안전. */
async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode'))
      el.src = url
    })
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) throw new Error('empty')
    const scaleDown = Math.min(1, MAX_DIM / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scaleDown))
    const h = Math.max(1, Math.round(ih * scaleDown))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

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
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [geoState, setGeoState] = useState<'locating' | 'ok' | 'unavailable'>('locating')
  const addrRef = useRef<string | null>(null)
  const [addr, setAddr] = useState<string | null>(null)

  // 열릴 때 GPS 확보 → 주소도 즉시 백그라운드 조회 (기록 시점에 준비돼 있으면 바로 사용)
  useEffect(() => {
    if (!open) return
    let active = true
    setBusy(false)
    setNote(null)
    setGeo(null)
    setGeoState('locating')
    addrRef.current = null
    setAddr(null)
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!active) return
          const g = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
          setGeo(g)
          setGeoState('ok')
          void reverseGeocode(g.lat, g.lng).then((a) => {
            if (active && a) {
              addrRef.current = a
              setAddr(a)
            }
          })
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

  /** 촬영 파일 도착 → 다운스케일 + SJ INVEST 워터마크 → 즉시 기록 (확인 단계 없음). */
  const onFile = async (file: File | null): Promise<void> => {
    if (!file) return
    setBusy(true)
    setNote(null)
    try {
      const canvas = await fileToCanvas(file)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      const w = canvas.width
      const h = canvas.height

      const now = new Date()
      const timestamp = now.toISOString()
      const timeStr = now.toLocaleString('ko-KR')
      const address = addrRef.current
      const coordStr = geo ? `${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} (±${Math.round(geo.accuracy)}m)` : ''
      const placeStr = address ?? (geo ? `GPS ${coordStr}` : '위치 미확인')
      const lateFee = label === '출근' ? lateFeeFor(now) : 0
      const watermarkText = [`${staffName} · ${label}`, timeStr, placeStr, lateFee > 0 ? `지각 · 벌금 ${feeLabel(lateFee)}` : '']
        .filter(Boolean)
        .join(' · ')

      // 하단 그라데이션 띠 + 이름/시각/주소/좌표, 좌상단 SJ INVEST 골드 배지, 지각 시 빨간 배지
      const scale = w / 1000
      const pad = Math.round(28 * scale)
      const stripH = Math.round((address ? 225 : 190) * scale)
      const grad = ctx.createLinearGradient(0, h - stripH, 0, h)
      grad.addColorStop(0, 'rgba(2,6,23,0)')
      grad.addColorStop(1, 'rgba(2,6,23,0.85)')
      ctx.fillStyle = grad
      ctx.fillRect(0, h - stripH, w, stripH)

      ctx.textBaseline = 'bottom'
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = Math.round(6 * scale)

      let y = h - pad
      if (coordStr) {
        ctx.fillStyle = 'rgba(226,232,240,0.85)'
        ctx.font = `${Math.round(24 * scale)}px sans-serif`
        ctx.fillText(coordStr, pad, y)
        y -= Math.round(32 * scale)
      }
      if (address) {
        ctx.fillStyle = '#e6c877'
        ctx.font = `${Math.round(28 * scale)}px sans-serif`
        ctx.fillText(address, pad, y)
        y -= Math.round(36 * scale)
      }
      ctx.fillStyle = '#e2e8f0'
      ctx.font = `${Math.round(32 * scale)}px sans-serif`
      ctx.fillText(timeStr, pad, y)
      y -= Math.round(44 * scale)
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.round(44 * scale)}px sans-serif`
      ctx.fillText(`${staffName} · ${label}`, pad, y)

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
      onCapture({ dataUrl, watermarkText, coords: geo, address, lateFee, timestamp })
    } catch {
      setNote('사진을 읽지 못했습니다. 다시 촬영해 주세요. (계속 안 되면 "사진 없이 기록"을 눌러 주세요)')
      setBusy(false)
    }
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

        {/* 후면 카메라 전용 입력 (전면/앨범 제거 — 대표 지시) */}
        <input
          ref={rearInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />

        <div className="flex flex-col gap-3 p-5">
          <button
            type="button"
            disabled={busy}
            onClick={() => rearInputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-6 text-lg font-extrabold text-white shadow-lg active:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            {busy ? '기록 중…' : '촬영하기'}
          </button>
          <p className="text-center text-[11px] text-neutral-500">촬영 확인을 누르면 바로 {label} 기록됩니다</p>
          {onSkip ? (
            <div className="flex justify-center">
              <button type="button" onClick={onSkip} className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline">
                사진 없이 기록
              </button>
            </div>
          ) : null}
          {note ? <p className="text-center text-xs text-[#fca5a5]">{note}</p> : null}
        </div>

        {/* GPS·주소 상태 (촬영을 막지 않음) */}
        <div className="flex items-center gap-1.5 border-t border-neutral-800 px-4 py-2 text-[11px]">
          {geoState === 'locating' ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-neutral-400" />
          ) : (
            <MapPin className={['h-3 w-3 shrink-0', geoState === 'ok' ? 'text-emerald-400' : 'text-rose-400'].join(' ')} />
          )}
          <span className={['truncate', geoState === 'ok' ? 'text-emerald-300' : geoState === 'unavailable' ? 'text-rose-300' : 'text-neutral-400'].join(' ')}>
            {geoState === 'ok'
              ? addr ?? `위치 확인됨 (±${Math.round(geo?.accuracy ?? 0)}m) · 주소 확인 중…`
              : geoState === 'unavailable'
                ? '위치 미확인 (기록은 가능)'
                : '위치 확인 중… (촬영은 바로 가능)'}
          </span>
        </div>
      </div>
    </div>
  )
}
