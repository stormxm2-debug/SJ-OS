-- 고지의무(인수기준) 보강: 질병 단위 일반안내 컬럼 + 실시간 + 자주 묻는 질병 24개 확대.
-- 보험사별 인수기준 값은 생성하지 않는다(팀이 실제 자료로 채움). 병명/별칭/일반안내만 추가.

alter table public.underwriting_diseases add column if not exists general_note text;

-- 기존 질병: 보험사별 note가 동일하므로 그중 하나를 general_note로 백필
update public.underwriting_diseases d
set general_note = sub.note
from (select distinct on (disease_id) disease_id, note
      from public.underwriting_rules order by disease_id, updated_at desc) sub
where d.id = sub.disease_id and (d.general_note is null or d.general_note = '');

-- 관리 화면 실시간 동기화
do $$ begin
  begin alter publication supabase_realtime add table public.underwriting_diseases; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.underwriting_rules; exception when duplicate_object then null; end;
end $$;

insert into public.underwriting_diseases (name, aliases, category, sort_order, general_note)
values
 ('자궁근종', array['근종'], '여성질환', 270, '크기·개수·수술 여부에 따라 상이. 무증상 소형은 표준/간편 검토, 수술 이력은 부담보 가능 — 청약 전 고지·인수심사 확인.'),
 ('유방 양성종양', array['섬유선종','유방섬유선종','유방양성'], '여성질환', 280, '양성·추적관찰 중심. 조직검사/수술 이력 고지 필요, 유방 관련 부담보 가능 — 인수심사 확인.'),
 ('자궁경부 이형성증', array['이형성','자궁경부'], '여성질환', 290, '등급·치료 여부에 따라 상이. 경증은 표준/간편 검토, 원추절제 이력은 부담보 가능 — 고지·심사 확인.'),
 ('난소낭종', array['난소물혹','낭종'], '여성질환', 300, '기능성 소형은 표준/간편 검토, 수술 이력은 부담보 가능 — 청약 전 고지 필요.'),
 ('신장결석', array['요로결석','결석','콩팥결석'], '신장·비뇨', 310, '재발·시술 이력에 따라 상이. 단발·완치는 표준/간편 검토, 반복은 부담보 가능 — 고지 필요.'),
 ('전립선비대', array['전립선','전립샘비대'], '신장·비뇨', 320, '투약 조절 양호 시 간편/표준 검토, PSA 이상·수술 이력 별도 고지 — 인수심사 확인.'),
 ('담낭용종·담석', array['담석','담낭','쓸개돌'], '소화기', 330, '소형 용종/무증상은 표준/간편 검토, 담낭절제 이력 고지 — 인수심사 확인.'),
 ('역류성 식도염', array['역류성','식도염'], '소화기', 340, '투약 조절 양호 시 표준/간편 검토 — 청약 전 진단·투약 고지.'),
 ('과민성 대장증후군', array['과민성대장','IBS'], '소화기', 350, '대체로 표준/간편 검토 대상 — 진단·투약 고지 필요.'),
 ('C형간염', array['C형','간염C'], '소화기', 360, '치료·완치 여부·간수치에 따라 상이 — 고지 필수, 인수심사 확인.'),
 ('대사증후군·고도비만', array['비만','고도비만','대사증후군'], '만성질환', 370, 'BMI·동반질환에 따라 할증/부담보 가능 — 신장·체중 및 병력 고지.'),
 ('수면무호흡증', array['수면무호흡','코골이'], '호흡기', 380, '중증도·치료(양압기) 여부에 따라 상이 — 진단·검사 이력 고지.'),
 ('만성폐쇄성폐질환(COPD)', array['COPD','폐기종','만성폐쇄성'], '호흡기', 390, '중증도에 따라 할증/부담보/거절 가능 — 흡연력·진단 고지, 인수심사 필수.'),
 ('폐결절', array['폐 결절'], '호흡기', 400, '크기·추적관찰 결과에 따라 상이. 양성 소형은 검토, 미확진은 보류 가능 — 영상·판독 고지.'),
 ('어깨 회전근개 질환', array['회전근개','어깨','오십견'], '근골격', 410, '수술·시술 이력에 따라 상이. 부위 부담보 가능 — 진단·치료 고지.'),
 ('십자인대·반월상연골', array['십자인대','반월상','연골판'], '근골격', 420, '수술 이력 시 해당 부위 부담보 흔함 — 진단·수술 고지.'),
 ('척추측만·척추질환', array['척추측만','척추'], '근골격', 430, '각도·증상에 따라 상이. 경증은 검토, 수술 이력은 부담보 가능 — 고지 필요.'),
 ('뇌동맥류', array['동맥류','뇌동맥류'], '심뇌혈관', 440, '미파열·시술 여부에 따라 상이, 부담보/거절 가능 — 반드시 고지·인수심사.'),
 ('위암 이력', array['위암'], '암 병력', 450, '완치 경과기간·재발 여부에 따라 상이. 유병자/표준 검토, 경과 짧으면 거절 가능 — 진단·치료 고지.'),
 ('대장암 이력', array['대장암'], '암 병력', 460, '완치 경과기간에 따라 상이 — 인수심사 필수.'),
 ('유방암 이력', array['유방암'], '암 병력', 470, '완치 경과·호르몬치료 여부에 따라 상이 — 진단·치료 고지, 인수심사 필수.'),
 ('간암 이력', array['간암'], '암 병력', 480, '경과기간 짧으면 거절 가능, 장기 완치 시 유병자 검토 — 인수심사 필수.'),
 ('불면증', array['불면','수면장애'], '정신건강', 490, '투약·기간에 따라 상이. 단기·경증은 검토, 장기 향정약은 별도 심사 — 고지 필요.'),
 ('조울증·조현병', array['조울증','양극성','조현병'], '정신건강', 500, '진단·투약 이력 반드시 고지, 부담보/거절 가능 — 인수심사 필수.')
on conflict do nothing;

-- 규칙 upsert(질병×보험사 1건)을 위한 유니크 제약
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.underwriting_rules'::regclass and conname='underwriting_rules_disease_insurer_key'
  ) then
    alter table public.underwriting_rules
      add constraint underwriting_rules_disease_insurer_key unique (disease_id, insurer);
  end if;
end $$;
