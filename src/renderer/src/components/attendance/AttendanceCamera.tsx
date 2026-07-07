import { useEffect, useRef, useState } from 'react'
import { Camera, X, MapPin, Loader2, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'

/**
 * 출퇴근 사진 촬영 + GPS·시간 워터마크.
 *
 * Opens the camera (getUserMedia), fetches the current GPS position, and — on
 * capture — burns a watermark (직원명 · 출근/퇴근, 촬영 시각, 위도/경도) directly
 * onto the photo via a canvas. Returns a JPEG data URL. On the staff mobile PWA the
 * browser prompts for camera + location natively; on the Electron desktop the main
 * process grants camera + geolocation for local origins (geolocation may be
 * unavailable → the photo is still captured with a "위치 미확인" watermark).
 *
 * The stream is always stopped on capture / cancel / unmount. No photo is logged.
 */
export interface CapturedAttendancePhoto {
  dataUrl: string
  watermarkText: string
  coords: { lat: number; lng: number; accuracy: number } | null
  timestamp: string
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
  /** Optional escape hatch when the camera can't open (e.g. desktop w/o webcam). */
  onSkip?: () => void
}): JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'ok' | 'unavailable'>('idle')

  const stopStream = (): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  // Start camera + geolocation when opened; always clean up.
  useEffect(() => {
    if (!open) return
    let active = true
    setReady(false)
    setCamError(null)
    setGeo(null)
    setGeoState('locating')

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        })
        if (!active) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setReady(true)
      } catch {
        if (active) setCamError('카메라를 열 수 없습니다. 권한을 허용했는지 확인해 주세요.')
      }
    })()

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
      stopStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const capture = (): void => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const w = video.videoWidth
    const h = video.videoHeight
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)

    const timestamp = new Date().toISOString()
    const timeStr = new Date().toLocaleString('ko-KR')
    const gpsStr = geo
      ? `GPS ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} (±${Math.round(geo.accuracy)}m)`
      : '위치 미확인'
    const watermarkText = `${staffName} · ${label} · ${timeStr} · ${gpsStr}`

    // Watermark: bottom gradient strip + 3 lines, plus a brand tag top-left.
    const scale = w / 1000
    const pad = Math.round(28 * scale)
    const stripH = Math.round(180 * scale)
    const grad = ctx.createLinearGradient(0, h - stripH, 0, h)
    grad.addColorStop(0, 'rgba(2,6,23,0)')
    grad.addColorStop(1, 'rgba(2,6,23,0.82)')
    ctx.fillStyle = grad
    ctx.fillRect(0, h - stripH, w, stripH)

    ctx.textBaseline = 'bottom'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = Math.round(6 * scale)

    // Line 1 (bottom): GPS
    ctx.fillStyle = geo ? '#a7f3d0' : '#fca5a5'
    ctx.font = `${Math.round(30 * scale)}px sans-serif`
    ctx.fillText(gpsStr, pad, h - pad)
    // Line 2: timestamp
    ctx.fillStyle = '#e2e8f0'
    ctx.font = `${Math.round(32 * scale)}px sans-serif`
    ctx.fillText(timeStr, pad, h - pad - Math.round(42 * scale))
    // Line 3 (top of strip): name · type
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.round(44 * scale)}px sans-serif`
    ctx.fillText(`${staffName} · ${label}`, pad, h - pad - Math.round(90 * scale))

    // Brand tag (top-left)
    ctx.font = `bold ${Math.round(28 * scale)}px sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.textBaseline = 'top'
    ctx.fillText('SJ OS 출퇴근', pad, pad)
    ctx.shadowBlur = 0

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    stopStream()
    onCapture({ dataUrl, watermarkText, coords: geo, timestamp })
  }

  const close = (): void => {
    stopStream()
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 bg-gradient-to-r from-indigo-950 to-slate-900 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Camera className="h-4 w-4 text-indigo-300" />
            {label} 사진 촬영
          </div>
          <button type="button" onClick={close} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative aspect-[3/4] w-full bg-slate-950">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {!ready && !camError ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" /> 카메라 준비 중…
            </div>
          ) : null}
          {camError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-rose-200">
              <AlertTriangle className="h-6 w-6" />
              {camError}
            </div>
          ) : null}
          {/* GPS status chip */}
          <div
            className={[
              'absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur',
              geoState === 'ok'
                ? 'bg-emerald-500/20 text-emerald-200'
                : geoState === 'unavailable'
                  ? 'bg-rose-500/20 text-rose-200'
                  : 'bg-slate-700/50 text-slate-200'
            ].join(' ')}
          >
            {geoState === 'locating' ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
            {geoState === 'ok'
              ? `위치 확인됨 (±${Math.round(geo?.accuracy ?? 0)}m)`
              : geoState === 'unavailable'
                ? '위치 미확인'
                : '위치 확인 중…'}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900 px-4 py-3">
          <button
            type="button"
            onClick={capture}
            disabled={!ready}
            className={[
              'inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition',
              ready
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-500/30 hover:brightness-110'
                : 'cursor-not-allowed bg-slate-700 text-slate-400'
            ].join(' ')}
          >
            <CheckCircle2 className="h-4 w-4" />
            촬영하고 {label} 기록
          </button>
          {camError ? (
            <button
              type="button"
              onClick={() => {
                setCamError(null)
                setReady(false)
                // Re-trigger the effect by toggling: simplest is to reload the stream.
                void (async () => {
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
                    streamRef.current = stream
                    if (videoRef.current) {
                      videoRef.current.srcObject = stream
                      await videoRef.current.play().catch(() => undefined)
                    }
                    setReady(true)
                  } catch {
                    setCamError('카메라를 열 수 없습니다. 권한을 허용했는지 확인해 주세요.')
                  }
                })()
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 px-3 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 다시
            </button>
          ) : null}
          {camError && onSkip ? (
            <button
              type="button"
              onClick={() => {
                stopStream()
                onSkip()
              }}
              className="inline-flex items-center rounded-xl px-3 py-2.5 text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
            >
              사진 없이 기록
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
