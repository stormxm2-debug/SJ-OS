import { useEffect, useState } from 'react'
import { Hand } from 'lucide-react'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import { ClapDetector } from '@renderer/services/jarvis/ClapDetector'
import { getClapEnabled, subscribeClap } from '@renderer/services/jarvis/clapSettings'

/**
 * 박수로 자비스 열기 — 앱 루트에 상주하는 리스너 (자비스가 닫혀 있을 때 동작).
 *
 * 설정(clapSettings)이 켜져 있고 자비스가 닫혀 있으며 탭이 보일 때만 마이크
 * 감지기를 돌린다. 더블 클랩 → jarvisService.open(). 자비스가 열리면·설정이
 * 꺼지면·탭이 숨겨지면 즉시 마이크를 놓는다(상시 청취 방지).
 * 켜져 있는 동안에는 우하단에 작은 표시를 항상 노출한다(프라이버시).
 */
export default function JarvisClapListener(): JSX.Element | null {
  const [enabled, setEnabled] = useState<boolean>(() => getClapEnabled())
  const [jarvisOpen, setJarvisOpen] = useState<boolean>(() => jarvisService.getState().isOpen)
  const [micError, setMicError] = useState<string | null>(null)

  useEffect(() => subscribeClap(() => setEnabled(getClapEnabled())), [])
  useEffect(() => jarvisService.subscribe(() => setJarvisOpen(jarvisService.getState().isOpen)), [])

  useEffect(() => {
    // 감지는 설정 ON + 자비스 닫힘일 때만. 열려 있으면 패널이 마이크를 쓰므로 양보.
    if (!enabled || jarvisOpen) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    const detector = new ClapDetector()
    let active = true
    void detector.start(() => jarvisService.open()).then((res) => {
      if (!active) {
        detector.stop()
        return
      }
      setMicError(res.ok ? null : res.error ?? '마이크를 사용할 수 없습니다.')
    })
    // 탭이 숨겨지면 마이크를 놓는다 (백그라운드 상시 청취 방지).
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') detector.stop()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVis)
      detector.stop()
    }
  }, [enabled, jarvisOpen])

  if (!enabled || jarvisOpen) return null

  return (
    <div
      className="fixed bottom-4 left-4 z-30 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-lg backdrop-blur"
      style={{
        borderColor: micError ? 'rgba(251,113,133,0.4)' : 'rgba(103,232,249,0.4)',
        color: micError ? '#fda4af' : '#9adcff',
        background: 'rgba(8,18,38,0.8)'
      }}
      title={micError ?? '박수 두 번이면 자비스가 열립니다'}
    >
      <span className="relative flex h-2 w-2">
        {!micError ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ background: 'rgba(103,232,249,0.7)' }} />
        ) : null}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: micError ? '#fb7185' : '#38bdf8' }} />
      </span>
      <Hand className="h-3 w-3" />
      {micError ? '박수 감지 불가' : '박수로 자비스 열기'}
    </div>
  )
}
