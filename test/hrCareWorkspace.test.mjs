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
