#!/usr/bin/env bash
# SJ CLAIM FINDER — RLS 정책을 **운영과 분리된 일회용 Postgres** 에 적용해 실검증한다.
# 운영 DB 를 전혀 건드리지 않는다(로컬 임시 클러스터만 사용).
#
# 적용 순서:
#   1) test/sql/claim_finder_rls_prereq.sql  (auth.uid/is_owner_or_admin/health_record_requests 합성)
#   2) supabase/migrations/20261102_claim_finder.sql  (실제 마이그레이션 그대로)
#   3) test/sql/claim_finder_rls_grants.sql   (authenticated 권한)
#   4) test/sql/claim_finder_rls_assert.sql   (교차 고객/직원 차단 시나리오)
#
# Postgres 는 root 로 못 돌리므로 비권한 사용자(기본: postgres)로 실행한다.
# 종료코드 0 = 전 시나리오 통과. 비0 = 실패.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGUSER_SYS="${PGUSER_SYS:-postgres}"   # 서버 프로세스를 소유할 비권한 OS 사용자
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "/tmp/cf-rls.XXXXXX")"
DATA="$WORK/data"
SOCK="$WORK/sock"
DB="claimfinder_rls_test"
mkdir -p "$DATA" "$SOCK"

# runuser 로 비권한 사용자 전환이 필요하면 래퍼, 아니면 그대로 실행.
if [ "$(id -u)" = "0" ]; then
  AS=(runuser -u "$PGUSER_SYS" --)
  chown -R "$PGUSER_SYS" "$WORK"
else
  AS=()
fi
run_as() { if [ "${#AS[@]}" -gt 0 ]; then "${AS[@]}" "$@"; else "$@"; fi; }

# SQL 파일을 WORK 로 복사(비권한 사용자가 읽을 수 있도록).
cp "$REPO/test/sql/claim_finder_rls_prereq.sql" \
   "$REPO/supabase/migrations/20261102_claim_finder.sql" \
   "$REPO/test/sql/claim_finder_rls_grants.sql" \
   "$REPO/test/sql/claim_finder_rls_assert.sql" "$WORK/"
if [ "$(id -u)" = "0" ]; then chown -R "$PGUSER_SYS" "$WORK"; fi

cleanup() {
  run_as "$PGBIN/pg_ctl" -D "$DATA" -s -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "[rls] initdb (throwaway cluster, isolated from prod)"
run_as "$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null

# TCP 끄고 유닉스 소켓만(완전 로컬). 포트 충돌·외부 노출 방지.
run_as "$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -c listen_addresses=''" -w -s start >/dev/null

PSQL() { run_as "$PGBIN/psql" -h "$SOCK" -U postgres -v ON_ERROR_STOP=1 "$@"; }

PSQL -d postgres -c "create database $DB" >/dev/null

echo "[rls] 1/4 prereq (synthetic auth + health_record_requests)"
PSQL -d "$DB" -q -f "$WORK/claim_finder_rls_prereq.sql" >/dev/null

echo "[rls] 2/4 real migration (20261102_claim_finder.sql)"
PSQL -d "$DB" -q -f "$WORK/20261102_claim_finder.sql" >/dev/null

echo "[rls] 3/4 grants"
PSQL -d "$DB" -q -f "$WORK/claim_finder_rls_grants.sql" >/dev/null

echo "[rls] 4/4 assertions"
PSQL -d "$DB" -f "$WORK/claim_finder_rls_assert.sql"

echo "[rls] OK — all scenarios passed (synthetic DB; prod schema compatibility NOT verified here)"
