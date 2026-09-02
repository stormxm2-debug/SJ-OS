/**
 * 매니저 연락처 시드 데이터 — 첨부된 「설계매니저」 엑셀에서 추출.
 * 최초 1회 자동 등록되며, 사용자가 새 엑셀을 올리면 대체/병합된다.
 */
import type { ContactsData } from './managerContacts'

export const MANAGER_CONTACTS_SEED: ContactsData = {
  sonbo: [
  { no: "1", company: "롯데", vice: "장세민", vicePhone: "010-8557-8908", head: "김은지", headPhone: "010-2299-2971", managers: [{ name: "하윤미", phone: "010-5014-2771" }] },
  { no: "2", company: "삼성", vice: "김혜지", vicePhone: "010-4747-9487", head: "박은정", headPhone: "010-3867-5168", managers: [{ name: "정혜란", phone: "010-5020-2626" }] },
  { no: "3", company: "흥국", vice: "조승현", vicePhone: "010-5028-3266", head: "이경우", headPhone: "010-7467-0165", managers: [{ name: "이승희", phone: "010-2588-2696" }] },
  { no: "4", company: "DB", vice: "", vicePhone: "", head: "신미영", headPhone: "010-5129-6022", managers: [{ name: "이미영", phone: "010-9970-2753" }] },
  { no: "5", company: "하나", vice: "양정혜", vicePhone: "010-2208-0741", head: "강정낭", headPhone: "010-9696-3680", managers: [{ name: "한샛별", phone: "010-4753-0741" }] },
  { no: "6", company: "한화", vice: "", vicePhone: "", head: "이인수", headPhone: "010-4340-8171", managers: [{ name: "정민영", phone: "010-3280-4680" }] },
  { no: "7", company: "현대", vice: "", vicePhone: "", head: "이하현", headPhone: "010-3557-9147", managers: [{ name: "김수정", phone: "010-4127-4423" }] },
  { no: "8", company: "메리츠", vice: "", vicePhone: "", head: "김금화", headPhone: "010-5170-0127", managers: [{ name: "김도이", phone: "010-4876-9943" }] },
  { no: "9", company: "라이나", vice: "박주선", vicePhone: "010-4093-6622", head: "김남현", headPhone: "010-2082-1600", managers: [{ name: "이은혜", phone: "010-8299-5073" }, { name: "정나겸", phone: "010-8521-3157" }] },
  { no: "10", company: "KB", vice: "", vicePhone: "", head: "김중형", headPhone: "010-6276-4862", managers: [{ name: "송원호", phone: "010-2735-3022" }] },
  { no: "11", company: "농협", vice: "", vicePhone: "", head: "임경호", headPhone: "010-2064-7866", managers: [{ name: "이가은", phone: "010-5149-7020" }] }
  ],
  saengbo: [
  { no: "1", company: "삼성", vice: "", vicePhone: "", head: "김민서", headPhone: "010-7296-5321", managers: [{ name: "박정숙", phone: "010-9606-6327" }] },
  { no: "2", company: "동양", vice: "", vicePhone: "", head: "최재용", headPhone: "010-9075-6646", managers: [{ name: "박은주", phone: "010-9072-0855" }, { name: "김호순", phone: "010-9953-0914" }, { name: "김은경", phone: "010-8634-6278" }] },
  { no: "3", company: "교보", vice: "", vicePhone: "", head: "연승민", headPhone: "010-6570-9824", managers: [{ name: "오수정", phone: "010-6375-8457" }] },
  { no: "4", company: "흥국", vice: "", vicePhone: "", head: "김정란", headPhone: "010-2758-6265", managers: [{ name: "정경이", phone: "010-3075-5470" }] },
  { no: "5", company: "메트", vice: "", vicePhone: "", head: "박형원", headPhone: "010-9096-7776", managers: [{ name: "유하정", phone: "010-4956-3579" }, { name: "김민주", phone: "010-7707-9082" }, { name: "윤나원", phone: "010-9009-7263" }] },
  { no: "6", company: "KDB", vice: "", vicePhone: "", head: "이상훈", headPhone: "010-3496-6725", managers: [{ name: "강진혜", phone: "010-9786-6325" }] },
  { no: "7", company: "DB", vice: "", vicePhone: "", head: "임유경", headPhone: "010-4335-8494", managers: [{ name: "지영훈", phone: "010-39922-3457" }] },
  { no: "8", company: "한화", vice: "", vicePhone: "", head: "허진호", headPhone: "010-5780-3259", managers: [{ name: "김혜진", phone: "010-2083-3937" }] },
  { no: "9", company: "신한", vice: "홍신유", vicePhone: "010-9887-0388", head: "이윤택", headPhone: "010-3232-3043", managers: [{ name: "천송이", phone: "010-6717-6481" }] },
  { no: "10", company: "라이나", vice: "", vicePhone: "", head: "김경실", headPhone: "010-7251-0181", managers: [{ name: "성다현", phone: "010-2624-9345" }] },
  { no: "11", company: "KB", vice: "", vicePhone: "", head: "김지원", headPhone: "010-3360-5676", managers: [{ name: "전예솔", phone: "010-7592-9808" }] },
  { no: "12", company: "미래", vice: "", vicePhone: "", head: "원경일", headPhone: "010-5648-5019", managers: [{ name: "김미경", phone: "010-7150-5060" }] },
  { no: "13", company: "카디프", vice: "", vicePhone: "", head: "강세진", headPhone: "010-8605-6053", managers: [{ name: "임나래", phone: "010-2282-5377" }] },
  { no: "14", company: "ABL", vice: "", vicePhone: "", head: "우수민", headPhone: "010-3930-7388", managers: [{ name: "위정은", phone: "010-3531-2327" }] }
  ]
}
