/**
 * SJ CLAIM FINDER — RLS 정책 실검증(서버 경계) 래퍼.
 *
 * 실제 Postgres 일회용 클러스터에 마이그레이션 RLS 를 적용해 교차 고객/직원 접근 차단을 검증한다.
 * (test/claim_finder_rls.sh). Postgres 서버 바이너리(initdb)가 없으면 스킵한다(CI 호환).
 *
 * ⚠️ 이것은 **서버 경계(DB RLS)** 테스트다. 순수 프런트 가드(access.ts) 테스트와 구별된다.
 *    단, 합성 격리 스키마이므로 **운영 스키마 호환성은 보장하지 않는다**(적용 전 재확인).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'claim_finder_rls.sh')

function hasInitdb() {
  const pgbin = process.env.PGBIN || '/usr/lib/postgresql/16/bin'
  if (existsSync(join(pgbin, 'initdb'))) return true
  try { execSync('command -v initdb', { stdio: 'ignore' }); return true } catch { return false }
}

test('RLS 서버 경계: 교차 고객/직원 접근 차단(실 Postgres)', { skip: !hasInitdb() && 'Postgres(initdb) 미설치 — 서버 경계 테스트 스킵' }, () => {
  const r = spawnSync('bash', [script], { encoding: 'utf8', timeout: 120000 })
  const out = (r.stdout || '') + (r.stderr || '')
  if (r.status !== 0) {
    assert.fail(`RLS 테스트 실패(exit ${r.status}):\n${out}`)
  }
  assert.match(out, /ALL \d+ RLS SCENARIOS PASSED/, '모든 RLS 시나리오가 통과해야 함')
})
