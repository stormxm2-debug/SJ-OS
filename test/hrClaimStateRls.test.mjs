// Isolated SQL engine only. Never reads production configuration or customer data.
// Optional QA dependency: npm install --prefix /tmp/sj-health-sql-qa @electric-sql/pglite
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
let PGlite
try { ({ PGlite } = require('@electric-sql/pglite')) } catch {
  if (process.env.SJ_HEALTH_SQL_QA_DIR) ({ PGlite } = require(join(process.env.SJ_HEALTH_SQL_QA_DIR,'node_modules/@electric-sql/pglite')))
}
const skip = !PGlite && '격리 SQL QA 엔진 미설치 — docs/HEALTH_RECORD_WORKSPACE.md 참고'
test('청구 상태 RPC: 실제 SQL 엔진에서 RLS·동의·보관기간·일괄 검증', { skip }, async()=>{
  const db=new PGlite()
  const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const own='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', expired='33333333-3333-4333-8333-333333333333', revoked='44444444-4444-4444-8444-444444444444'
  const key='hrv1-'+'a'.repeat(64), next='hrv1-'+'b'.repeat(64)
  try {
    await db.exec(`
      create role authenticated nologin;
      create role anon nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function public.is_owner_or_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.app_role',true),'') in ('owner','admin') $$;
      grant usage on schema auth to authenticated,anon;
      create table public.health_record_requests(id uuid primary key,staff_id uuid not null,status text not null,consent_at timestamptz,result jsonb,created_at timestamptz default now());
      alter table public.health_record_requests enable row level security;
      create policy hr_select on public.health_record_requests for select to authenticated using (staff_id=auth.uid() or public.is_owner_or_admin());
      create policy hr_update on public.health_record_requests for update to authenticated using (staff_id=auth.uid() or public.is_owner_or_admin()) with check(staff_id=auth.uid() or public.is_owner_or_admin());
      grant select,update on public.health_record_requests to authenticated;
      insert into public.health_record_requests(id,staff_id,status,consent_at,result,created_at) values
        ('${own}','${a}','completed',now(),'{}',now()),
        ('${other}','${b}','completed',now(),'{}',now()),
        ('${expired}','${a}','completed',now(),'{}',now()-interval '31 days'),
        ('${revoked}','${a}','expired',now(),'{}',now());
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20261105_health_record_claim_states.sql',import.meta.url),'utf8'))
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`)
    const read=async id=>(await db.query('select public.get_health_record_claim_states($1) as states',[id])).rows[0].states
    const save=async(id,keys,status)=>(await db.query('select public.set_health_record_claim_states($1,$2,$3) as states',[id,keys,status])).rows[0].states
    assert.deepEqual(await read(own),{})
    const saved=await save(own,[key],'claimed')
    assert.equal(saved[key].status,'claimed');assert.equal(saved[key].checked_by,a)
    assert.equal((await read(own))[key].status,'claimed')
    for(const id of [other,expired,revoked]) {
      await assert.rejects(()=>read(id))
      await assert.rejects(()=>save(id,[key],'claimed'))
    }
    await assert.rejects(()=>save(own,[next,'invalid'],'unclaimed'))
    assert.equal((await read(own))[next],undefined)
    await assert.rejects(()=>save(own,[],'claimed'))
    await assert.rejects(()=>save(own,[key],'paid'))
    await assert.rejects(()=>save(own,Array(201).fill(key),'claimed'))
    // Second staff cannot read first staff's markers, including through RPC.
    await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);`)
    await assert.rejects(()=>read(own))
    assert.deepEqual(await read(other),{})
    // Admin follows the existing explicit admin access policy, never retention bypass.
    await db.exec("select set_config('test.app_role','admin',false);")
    assert.equal((await read(own))[key].status,'claimed')
    await assert.rejects(()=>read(expired))
    // Revoking consent immediately blocks a previously readable completed request.
    await db.exec(`update public.health_record_requests set consent_at=null where id='${own}';`)
    await assert.rejects(()=>read(own))
    await assert.rejects(()=>save(own,[key],'unclaimed'))
    await db.exec('reset role; set role anon;')
    await assert.rejects(()=>read(other))
  } finally { await db.close() }
})
