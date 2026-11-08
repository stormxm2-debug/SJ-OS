import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { webcrypto } from 'node:crypto'
import { pathToFileURL } from 'node:url'

async function load(src) {
  const output = await build({ entryPoints:[src], bundle:true, format:'esm', platform:'node', write:false, tsconfig:'tsconfig.web.json', logLevel:'silent' })
  const dir=await mkdtemp(join(tmpdir(),'sj-health-workspace-')), file=join(dir,'module.mjs')
  await writeFile(file,output.outputFiles[0].text)
  return import(pathToFileURL(file).href)
}
if (!globalThis.crypto) Object.defineProperty(globalThis,'crypto',{value:webcrypto})
const care = await load('src/renderer/src/services/health-record/careWorkspace.ts')
const store = await load('src/renderer/src/services/health-record/claimStateStore.ts')
const print = await load('src/renderer/src/services/health-record/printCareRecords.ts')
const context = await load('supabase/functions/health-record-ai/underwritingContext.ts')
const requestId='11111111-1111-4111-8111-111111111111'
const base={resTreatStartDate:'20261101',resHospitalName:'가상병원',resTreatType:'입원',resDiseaseName:'무릎 통증',resDiseaseCode:'M25.56',resVisitDays:'3'}

test('달력 월말·윤년과 현지 날짜를 기준으로 기간 계산',()=>{
  assert.equal(care.periodStart('3m',new Date(2024,4,31)),'20240229')
  assert.equal(care.periodStart('3m',new Date(2025,4,31)),'20250228')
  assert.equal(care.periodStart('1y',new Date(2024,1,29)),'20230228')
  assert.equal(care.calendarMonthsAgo(0,new Date(2026,10,5)),'20261105')
})
test('기간 경계 포함·미래·무효 날짜 제외, 원본 불변',()=>{
  const original={resBasicTreatList:['20260805','20260804','20261105','20261106','20260230',''].map(d=>({...base,resTreatStartDate:d}))}
  const filtered=care.filterCareResult(original,'3m',new Date(2026,10,5))
  assert.deepEqual(filtered.resBasicTreatList.map(r=>r.resTreatStartDate),['20260805','20261105'])
  assert.equal(original.resBasicTreatList.length,6)
  assert.equal(care.filterCareResult(original,'all'),original)
  assert.equal(care.validCareDate('20260230'),false)
})
test('약물 별도 기관 기록 보존, 날짜·기관 미상은 연결하지 않음',()=>{
  const rows=care.buildCareRecords({resBasicTreatList:[base,{resDiseaseName:'미상'}],resPrescribeDrugList:[{resTreatStartDate:'20261101',resHospitalName:'별도약국',resDrugName:'타미플루',resTotalDosingdays:'5'},{resDrugName:'미상약'}]})
  assert.equal(rows.length,4)
  assert.ok(rows.some(r=>r.hospital==='별도약국' && r.medications[0].flu))
  assert.ok(!rows.find(r=>r.disease==='미상').medications.length)
})
test('독감 약물은 성분·명칭 확인 표시만, 일반 감기약은 제외',()=>{
  assert.equal(care.fluMedication('성분명','Oseltamivir'),true)
  assert.equal(care.fluMedication('조플루자정'),true)
  assert.equal(care.fluMedication('아세트아미노펜'),false)
})
test('수술 추정은 단순 처치와 구분하고 원자료 입원일수·코드·좌우 보존',()=>{
  const rows=care.buildCareRecords({resBasicTreatList:[{...base,resSide:'L'}],resDetailTreatList:[{...base,resCodeName:'석고 고정',resTreatType:'처치'}]})
  assert.equal(rows[0].surgery,false);assert.equal(rows[0].admissionDays,3);assert.equal(rows[0].side,'왼쪽');assert.equal(rows[0].code,'M25.56')
  assert.equal(care.sideFromSource({resDiseaseName:'오른쪽 무릎 통증'}),'오른쪽')
  assert.equal(care.sideFromSource({resDiseaseName:'무릎 통증'}),'미확인')
})
test('질병 코드·좌우는 별도 필드가 없어도 명시된 정보만 보존',()=>{
  const row=care.buildCareRecords({resBasicTreatList:[{...base,resDiseaseName:'좌측 팔 통증(M79.6)',resDiseaseCode:undefined}]})[0]
  assert.equal(row.code,'M79.6');assert.equal(row.side,'왼쪽')
})
test('입원 일수 미제공은 0일로 단정하지 않고 같은 방문을 중복 합산하지 않음',()=>{
  const rows=care.buildCareRecords({resBasicTreatList:[base,{...base,resDiseaseName:'다른 진단'}, {...base,resTreatStartDate:'20261001',resVisitDays:''}]})
  assert.deepEqual(care.admissionSummary(rows),{knownDays:3,unknown:1})
})
test('세부 수술만 있는 응답도 업무표에서 누락하지 않음',()=>{
  const rows=care.buildCareRecords({resDetailTreatList:[{resTreatStartDate:'20261002',resHospitalName:'병원',resTreatType:'수술',resCodeName:'충수 절제술'}]})
  assert.equal(rows.length,1);assert.equal(rows[0].surgery,true)
})
test('청구 키는 순서와 무관하고 직접 식별자가 없는 SHA256',async()=>{
  const row=care.buildCareRecords({resBasicTreatList:[base]})[0]
  const key=await care.claimRecordKey(row)
  assert.match(key,/^hrv1-[0-9a-f]{64}$/)
  assert.equal(key,await care.claimRecordKey(care.buildCareRecords({resBasicTreatList:[{...base}]})[0]))
  assert.notEqual(key,await care.claimRecordKey({...row,key:row.key+'different'}))
})
test('인수 기준은 병명·별칭 정확히 일치한 행만 연결하며 미매칭을 승인하지 않음',()=>{
  const rows=care.buildCareRecords({resBasicTreatList:[base]})
  const guides=[{id:'g1',name:'무릎 통증',aliases:[],rules:{삼성화재:{status:'exclusion',verified:true,note:'조건 확인'}}},{id:'g2',name:'통증',aliases:[],rules:{삼성화재:{status:'standard',verified:true}}}]
  const found=care.matchCareGuides(rows,guides,[],['삼성화재'])
  assert.equal(found.guides.length,1);assert.equal(found.guides[0].status,'exclusion')
  assert.equal(care.matchCareGuides(rows,guides,[],['없는 보험사']).guides.length,0)
})
test('청구 저장은 서버 확인 전 성공하지 않고 원자료를 전송하지 않음',async()=>{
  const key='hrv1-'+'a'.repeat(64),calls=[]
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{[key]:{status:'claimed',checked_at:'2026-11-05',checked_by:'staff'}},error:null}}}
  const result=await store.createHealthClaimStore(async()=>client).save(requestId,[key],'claimed')
  assert.equal(result.ok,true)
  assert.equal(calls[0].name,'set_health_record_claim_states')
  assert.deepEqual(calls[0].args,{p_request_id:requestId,p_record_keys:[key],p_status:'claimed'})
  assert.ok(!JSON.stringify(calls).includes('가상병원'))
})
test('서버 저장 미확인·권한 오류·미구성은 저장 성공으로 처리하지 않음',async()=>{
  const key='hrv1-'+'a'.repeat(64)
  for(const response of [{data:{},error:null},{data:null,error:{message:'private vendor detail'}},{data:[],error:null}]) {
    const result=await store.createHealthClaimStore(async()=>({rpc:async()=>response})).save(requestId,[key],'claimed')
    assert.equal(result.ok,false)
    assert.ok(!result.error.includes('private vendor detail'))
  }
  assert.equal((await store.createHealthClaimStore(async()=>null).load(requestId)).ok,false)
})
test('잘못된 키·요청·상태는 서버 호출 없이 거부',async()=>{
  let called=false
  const service=store.createHealthClaimStore(async()=>{called=true;return null})
  assert.equal((await service.save(requestId,['병원명'],'claimed')).ok,false)
  assert.equal((await service.save(requestId,[],'claimed')).ok,false)
  assert.equal((await service.load('unknown')).ok,false)
  assert.equal(called,false)
})
test('AI 컨텍스트는 검수된 선택 보험사 기준만 허용, 알 수 없는 필드 제외',()=>{
  const clean=context.safeUnderwritingContext({rrn:'should-not-pass',insurers:['삼성화재'],guides:[{insurer:'삼성화재',disease:'무릎 통증',status:'exclusion',verified:true,rrn:'should-not-pass'},{insurer:'삼성화재',disease:'검수전',verified:false},{insurer:'다른 보험사',verified:true}],exceptions:[{insurer:'삼성화재',disease:'무릎 통증',productClass:'325',verified:true,customerName:'should-not-pass'}]})
  assert.equal(clean.guides.length,1);assert.equal(clean.exceptions.length,1)
  assert.ok(!JSON.stringify(clean).includes('should-not-pass'))
  assert.match(context.UNDERWRITING_INSTRUCTIONS,/추가 확인 필요/)
})
test('인쇄 HTML은 의료기관·상병·약물 문자열을 실행 가능한 HTML로 삽입하지 않음',()=>{
  const rows=care.buildCareRecords({resBasicTreatList:[{...base,resHospitalName:'<script>alert(1)</script>'}]})
  const html=print.carePrintHtml(rows,()=> 'unclaimed','<img src=x onerror=alert(1)>')
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('미청구'))
})
test('응답 지연·본인확인·이용 시간 오류에 각각 다른 다음 조치',()=>{
  assert.match(care.healthErrorHelp('응답 시간이 초과되었습니다.').action,/최근 요청/)
  assert.match(care.healthErrorHelp('주민등록번호 오류').action,/담당자/); assert.doesNotMatch(care.healthErrorHelp('주민등록번호 오류').action,/identity|암호화/)
  assert.match(care.healthErrorHelp('서비스 이용 시간 제한').action,/공식/)
})
test('최근 3개월 요약: 달력 경계 포함, 미래·무효·누락 날짜는 미확인으로 분리',()=>{
  const today=new Date(2026,10,5)
  const result={resBasicTreatList:['20260805','20260804','20261105','20261106','20260230',''].map((d,i)=>({...base,resTreatStartDate:d,resDiseaseName:`진단${i}`}))}
  const s=care.recentCareSummary(result,today)
  assert.equal(s.start,'20260805');assert.equal(s.end,'20261105')
  assert.deepEqual(s.records.map(r=>r.date),['20261105','20260805'])
  assert.equal(s.undated,2)
  assert.equal(s.total,6)
  // Actual fetched range only; not proof of a full 5-year inquiry.
  assert.equal(s.oldest,'20260804');assert.equal(s.latest,'20261106')
  // Shared-period filtering of the same input is unaffected.
  assert.equal(result.resBasicTreatList.length,6)
})
test('최근 3개월 요약: 약물 단독·기관 미상 기록을 숨기거나 다른 병원에 연결하지 않고 일수 미제공은 0일 그대로',()=>{
  const today=new Date(2026,10,5)
  const s=care.recentCareSummary({resBasicTreatList:[base],resPrescribeDrugList:[{resTreatStartDate:'20261101',resDrugName:'단독약'},{resTreatStartDate:'20261102',resHospitalName:'별도약국',resDrugName:'감기약',resTotalDosingdays:'3'}]},today)
  const alone=s.records.find(r=>r.medications[0]?.name==='단독약')
  assert.ok(alone);assert.equal(alone.hospital,'');assert.equal(alone.medications[0].days,0)
  assert.ok(!s.records.find(r=>r.hospital==='가상병원').medications.length)
  assert.equal(s.records.find(r=>r.hospital==='별도약국').medications[0].days,3)
})
test('최근 3개월 요약: 빈 응답과 기간 밖 기록을 구분',()=>{
  const today=new Date(2026,10,5)
  const empty=care.recentCareSummary({},today)
  assert.equal(empty.total,0);assert.equal(empty.records.length,0);assert.equal(empty.latest,'')
  const old=care.recentCareSummary({resBasicTreatList:[{...base,resTreatStartDate:'20250101'}]},today)
  assert.equal(old.total,1);assert.equal(old.records.length,0);assert.equal(old.latest,'20250101')
})
test('공통 기간 목록과 핵심 숫자는 같은 기록에서 계산: 기간별 건수 일치, 날짜 미확인은 전체에서만',()=>{
  const today=new Date(2026,10,5)
  const dates=['20261105','20260805','20260804','20251105','20251104','20240101','20211105','']
  const result={resBasicTreatList:dates.map((d,i)=>({...base,resTreatStartDate:d,resDiseaseName:`진단${i}`,resTreatType:i===1?'입원':'외래'}))}
  const expected={'3m':2,'1y':4,'3y':6,'5y':7,all:8}
  for (const p of care.CARE_PERIODS.map(x=>x.value)) {
    const list=care.careListSummary(result,p,today)
    const kpiRows=care.buildCareRecords(care.filterCareResult(result,p,today))
    assert.equal(list.records.length,expected[p],p)
    assert.deepEqual(list.records.map(r=>r.key),kpiRows.map(r=>r.key),p)
    assert.equal(care.careKpis(kpiRows).records,list.records.length,p)
    assert.equal(list.undated,1)
  }
  assert.ok(care.careListSummary(result,'all',today).records.some(r=>r.date===''))
  assert.ok(!care.careListSummary(result,'5y',today).records.some(r=>r.date===''))
  assert.equal(care.careListSummary(result,'all',today).start,'')
  // Default list period ('3m') equals the former fixed recent summary.
  assert.deepEqual(care.recentCareSummary(result,today).records.map(r=>r.key),care.careListSummary(result,'3m',today).records.map(r=>r.key))
})
test('핵심 숫자: 건수 의미 유지, 입원일수 미확인은 0일로 합산하지 않고 수술은 방문별 1회',()=>{
  const rows=care.buildCareRecords({resBasicTreatList:[
    {...base,resTreatStartDate:'20261101',resHospitalName:'A병원',resVisitDays:'4'},
    {...base,resTreatStartDate:'20261101',resHospitalName:'A병원',resDiseaseName:'다른 병명',resVisitDays:'4'},
    {...base,resTreatStartDate:'20261102',resHospitalName:'B병원',resVisitDays:''},
    {...base,resTreatStartDate:'20261103',resHospitalName:'C병원',resTreatType:'외래',resDiseaseName:'수술 후 관찰'}
  ],resDetailTreatList:[{resTreatStartDate:'20261101',resHospitalName:'A병원',resOperationName:'관절경 수술'}]})
  const k=care.careKpis(rows)
  assert.equal(k.records,4)
  assert.equal(k.admissionKnownDays,4)
  assert.equal(k.admissionUnknown,1)
  assert.equal(k.surgeries,1)
  const none=care.careKpis(care.buildCareRecords({resBasicTreatList:[{...base,resVisitDays:''}]}))
  assert.equal(none.admissionKnownDays,0);assert.equal(none.admissionUnknown,1)
})
test('요약 숫자 카드 필터: 기간 전체 대상·입원일수 미확인 포함·입원+수술 겹침·원자료/숫자 불변',()=>{
  const today=new Date(2026,10,9)
  // 최신순 10건 중 7번째 이후에만 입원·수술이 있도록 구성(INITIAL_ROWS=6 자르기 전에 필터해야 찾을 수 있음).
  const list=[]
  for(let i=1;i<=6;i++) list.push({...base,resTreatType:'외래',resTreatStartDate:`202611${String(i).padStart(2,'0')}`,resHospitalName:`통원${i}병원`,resVisitDays:'1'})
  list.push({...base,resTreatStartDate:'20261020',resHospitalName:'입원미확인병원',resVisitDays:''})
  list.push({...base,resTreatStartDate:'20261019',resHospitalName:'입원수술병원',resVisitDays:'5'})
  list.push({...base,resTreatType:'외래',resTreatStartDate:'20261018',resHospitalName:'외래수술병원'})
  list.push({...base,resTreatStartDate:'',resHospitalName:'날짜미상병원',resVisitDays:'2'})
  const result={resBasicTreatList:list,resDetailTreatList:[
    {resTreatStartDate:'20261019',resHospitalName:'입원수술병원',resOperationName:'관절경 수술'},
    {resTreatStartDate:'20261018',resHospitalName:'외래수술병원',resOperationName:'봉합 수술'}]}
  const snapshot=JSON.stringify(result)
  const s=care.careListSummary(result,'3m',today)
  assert.equal(s.records.length,9)
  const before=care.careKpis(s.records)
  const inpatient=care.filterSummaryRecords(s.records,'inpatient')
  assert.deepEqual(inpatient.map(r=>r.hospital),['입원미확인병원','입원수술병원'])
  assert.equal(inpatient[0].admissionDays,null) // 일수 미확인 입원도 입원 필터에 포함
  const surgery=care.filterSummaryRecords(s.records,'surgery')
  assert.deepEqual(surgery.map(r=>r.hospital),['입원수술병원','외래수술병원']) // 입원+수술 행은 두 필터 모두에
  assert.ok(s.records.indexOf(surgery[1])>=6) // 7번째 이후 기록도 필터 결과에 포함
  assert.equal(care.filterSummaryRecords(s.records,'all'),s.records)
  // 필터는 목록 표시용 — 원자료·기간 레코드·숫자(건수/입원 일수/수술 회수)는 그대로.
  assert.equal(JSON.stringify(result),snapshot)
  assert.equal(s.records.length,9)
  assert.deepEqual(care.careKpis(s.records),before)
  assert.deepEqual(before,{records:9,admissionKnownDays:5,admissionUnknown:1,surgeries:2})
  // 날짜 미확인은 '전체' 기간에서만, 필터도 전체 기간 대상.
  const all=care.careListSummary(result,'all',today)
  assert.ok(care.filterSummaryRecords(all.records,'inpatient').some(r=>r.hospital==='날짜미상병원'))
  assert.ok(!inpatient.some(r=>r.hospital==='날짜미상병원'))
  // 0건: 수술·입원이 없는 기간 → 빈 배열(실제 없음 단정은 UI 문구가 조회 범위로 안내)
  const outpatientOnly=care.careListSummary({resBasicTreatList:list.slice(0,6)},'3m',today)
  assert.equal(care.filterSummaryRecords(outpatientOnly.records,'inpatient').length,0)
  assert.equal(care.filterSummaryRecords(outpatientOnly.records,'surgery').length,0)
})
test('입원 배지 문구: 확인된 양수 일수만 N일, 미확인·무효는 일수 확인 필요, 통원/확인 필요는 없음',()=>{
  const r=(kind,admissionDays)=>({key:'k',date:'20261101',hospital:'가상병원',disease:'x',code:'',side:'미확인',kind,surgery:false,admissionDays,medications:[],procedures:[],selfPay:0})
  assert.equal(care.admissionBadgeLabel(r('입원',3)),'입원 3일')
  for(const d of [null,0,-1,1.5,NaN]) assert.equal(care.admissionBadgeLabel(r('입원',d)),'입원 · 일수 확인 필요')
  assert.equal(care.admissionBadgeLabel(r('통원',3)),null)
  assert.equal(care.admissionBadgeLabel(r('확인 필요',null)),null)
})
