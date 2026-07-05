import { useState } from 'react'
import { Clock, LogIn, LogOut, MapPin } from 'lucide-react'
import { attendanceService } from '@renderer/services/mvp'

/**
 * 출퇴근 (MVP). Local mock attendance — check-in/out is local state only.
 * Future: replace with attendanceService server API.
 */
export default function AttendancePage(): JSX.Element {
  const team = attendanceService.teamPresent()
  const [status, setStatus] = useState<'미출근' | '출근' | '외근' | '퇴근'>('출근')
  const [checkInTime] = useState('08:52')

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">출퇴근</h1>
        <p className="text-sm text-slate-500">상용 MVP 로컬 데이터 · 실제 근태 서버는 다음 단계에서 연결됩니다.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700">
          <Clock className="h-5 w-5 text-indigo-500" />
          <span className="text-sm">오늘 상태: <span className="font-semibold">{status}</span>{status === '출근' ? ` (${checkInTime} 출근)` : ''}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setStatus('출근')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"><LogIn className="h-4 w-4" /> 출근</button>
          <button type="button" onClick={() => setStatus('외근')} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"><MapPin className="h-4 w-4" /> 외근</button>
          <button type="button" onClick={() => setStatus('퇴근')} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"><LogOut className="h-4 w-4" /> 퇴근</button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-slate-700">오늘 팀 출근 현황</div>
        <div className="mt-1 text-2xl font-bold text-slate-800">{team.present} / {team.total} 명 출근</div>
      </div>
    </div>
  )
}
