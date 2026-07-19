import { Navigation } from 'lucide-react'

/**
 * 주소/장소 → 네비 바로 연결 (카카오맵 · 티맵 · 네이버지도).
 *
 * - 카카오맵/네이버지도: 웹 유니버설 링크 — 폰에서는 설치된 앱으로 이어지고,
 *   PC에서는 웹 지도가 열린다.
 * - 티맵: 웹 버전이 없어 앱 스킴(tmap://) 사용 — 폰에 티맵이 설치된 경우에만 열린다.
 *
 * 일정 카드와 고객정보가 공유하는 컴포넌트 — 지도 추가/변경은 여기 한 곳만 수정.
 */
export default function MapNavButtons({ location }: { location: string }): JSX.Element {
  const enc = encodeURIComponent(location)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <a
        href={`https://map.kakao.com/link/search/${enc}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-full bg-[#FEE500] px-2.5 py-1 text-[10px] font-bold text-[#3C1E1E] transition hover:brightness-95"
      >
        <Navigation className="h-3 w-3" /> 카카오맵
      </a>
      <a
        href={`tmap://search?name=${enc}`}
        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700 transition hover:bg-[#e0f2fe]"
      >
        <Navigation className="h-3 w-3" /> 티맵
      </a>
      <a
        href={`https://map.naver.com/p/search/${enc}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-full bg-[#03C75A] px-2.5 py-1 text-[10px] font-bold text-white transition hover:brightness-95"
      >
        <Navigation className="h-3 w-3" /> 네이버지도
      </a>
    </span>
  )
}
