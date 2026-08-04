import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'

/**
 * 화면 단위 에러 경계.
 *
 * React 18은 렌더 중 예외가 하나라도 터지면 트리 전체를 언마운트하고 #root를 비운다
 * → 앱이 통째로 백화면. public/boot-watchdog.js는 '부팅 8초' 시점만 보므로 이미
 * 떠 있던 앱이 화면 이동 중에 죽는 경우는 못 잡는다(2026-07-21 백화면 사건과 같은 증상).
 *
 * 그래서 라우터 출력만 감싸서, 한 화면이 죽어도 앱 껍데기(사이드바·하단탭)는 살리고
 * [다시 시도]/[홈으로]로 빠져나갈 수 있게 한다. route 이름을 key로 주면 화면을 옮기는
 * 것만으로도 자동 복구된다.
 */

interface Props {
  children: ReactNode
  /** 홈으로 돌아가는 동작 (셸마다 라우팅 방식이 달라 주입받는다) */
  onGoHome?: () => void
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 콘솔에만 남긴다 — 고객/직원 데이터가 섞일 수 있어 서버 전송은 하지 않는다.
    console.error('[SJ-OS] 화면 렌더 오류:', error?.message, info?.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  private goHome = (): void => {
    this.setState({ error: null })
    this.props.onGoHome?.()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#c6982f]/40 bg-white p-5 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-2 h-9 w-9 text-[#b0821f]" />
          <h2 className="text-sm font-extrabold text-slate-100">이 화면을 여는 중 문제가 생겼습니다</h2>
          <p className="mt-1.5 text-[12px] leading-5 text-slate-500">
            다른 화면은 정상입니다. 아래 버튼으로 다시 시도하거나 홈으로 이동해주세요.
            <br />
            계속 반복되면 대표님께 알려주세요.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] px-4 py-2 text-[12px] font-extrabold text-[#e6c877]"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 다시 시도
            </button>
            {this.props.onGoHome ? (
              <button
                type="button"
                onClick={this.goHome}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-4 py-2 text-[12px] font-bold text-slate-500 hover:text-slate-100"
              >
                <Home className="h-3.5 w-3.5" /> 홈으로
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }
}
