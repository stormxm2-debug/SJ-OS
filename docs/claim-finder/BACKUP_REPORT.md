# SJ-OS 백업 보고서 (SJ CLAIM FINDER 작업 전)

> 목적: SJ CLAIM FINDER(보험금 발굴) 기능 구현 **전** 상태를 복구 가능하게 백업.
> 범위: **코드(Git) 백업만.** 운영 DB(Supabase) 백업은 **수행하지 않음** — 아래 "DB 백업" 절 참조.

## 1. 기준(baseline)
- 저장소: `github.com/stormxm2-debug/sj-os` (리다이렉트: `.../SJ-OS`)
- 백업 시각(UTC): 2026-11-02T17:20Z
- **기준 커밋 SHA (origin/main): `5beca0fd26aa5d26d4bcf2cfda301195c79a7df3`**
  - 메시지: `fix(health-record): 내진료정보열람 주민번호를 평문(TLS)으로 전송 — '주민번호 잘못됨' 해결 (#47)`
- **열린 PR: 0건** (조회 시점 기준, state=open 없음)
- 원격 refs 총 114개 (heads 18 + 다수 tags/pull refs). 전체 목록: `remote-refs-20261102T172116Z.txt`

### 원격 브랜치(heads) 18개
```
backup/local-20260826
claude/audit-fixes
claude/coverage-analysis
claude/coverage-tool-standalone
claude/disable-family-bday-login-popup
claude/fix-login-supabase-env
claude/hide-dev-ui
claude/manager-contacts-excel-upload-8jd6u0
claude/menu-top-beta
feat/health-record-my-medical-info
feat/health-record-nhis
feat/health-record-result-columns
feat/mask-rrn-input
feature/overnight-setup
fix/codef-pubkey-robust
fix/codef-public-key-normalize
fix/health-record-rrn-no-encrypt
main
```

## 2. 백업 산출물 (코드)
| 항목 | 값 |
|---|---|
| 전체 번들 | `sj-os-backup-20261102T172059Z.bundle` (4.1 MB, sha1) |
| 번들 검증 | `git bundle verify` → **"The bundle records a complete history."** (정상) |
| 번들 내용 | `--all` (모든 heads·tags·HEAD 포함, 완전 이력) |
| 원격 refs 스냅샷 | `remote-refs-20261102T172116Z.txt` (114 refs) |
| 작업 클론 상태 | **clean** (새 클론, 미추적/추적 로컬 변경 없음) |

### 로컬 변경 보존
- 이번 백업은 **새로 클론한 깨끗한 작업트리**에서 수행 → 보존할 미커밋 로컬 변경 **없음**.
- 이전(사라진) 클라우드 컨테이너의 작업트리에 있던 내용은 모두 이미 `main`에 머지되어 GitHub에 반영됨(PR #30~#47). 별도 patch/archive 불필요.
- (만약 향후 미커밋 변경을 백업해야 하면: `git diff > tracked.patch`, `git stash create` 또는 `git archive`로 아카이브.)

## 3. 영구 복구 위치
1. **GitHub 백업 브랜치(권장, 영구)**: `backup/pre-claim-finder-20261102` → `5beca0f` 고정.
   - 배포 트리거 안 됨(워크플로는 `main` push에만 동작, 백업 브랜치는 무관).
   - 복구: `git fetch origin && git checkout -B main backup/pre-claim-finder-20261102` 후 (**권한 있는 롤백일 때만**) `git push --force-with-lease origin main`.
2. **GitHub 자체**: 모든 커밋/브랜치/태그가 origin에 존재(영구). 컨테이너가 사라져도 유지.
3. **번들 파일(오프라인)**: 이 채팅에 첨부되어 **다운로드 가능**. 보관 권장.
   - 복구: `git clone sj-os-backup-20261102T172059Z.bundle restored` (모든 ref 포함) 또는
     `git bundle verify <bundle>` 후 `git fetch <bundle> 'refs/heads/*:refs/heads/*'`.

> 클라우드 환경(컨테이너·스크래치패드)은 비영구. 따라서 **(1) 백업 브랜치**와 **(3) 다운로드한 번들**이 영구 복구 수단. 스크래치패드의 번들/보고서는 세션 종료 시 사라질 수 있으므로 **첨부본을 반드시 내려받아 보관**하세요.

## 4. DB 백업 (중요 — 미수행)
- **운영 DB(Supabase 프로젝트 `kmjnluubjgyxkppxxjel`)는 백업하지 않았습니다.**
- 사용자 지침("운영 DB 변경 금지")에 따라 이번 작업은 **DB를 변경하지 않으며**, 새 테이블은 **마이그레이션 파일로만** 준비하고 **적용(apply)하지 않습니다.**
- DB 백업이 필요하면 별도로: Supabase 대시보드 → Database → Backups(자동 일일 백업 확인) 또는 `pg_dump`(서비스 롤 자격 필요). **본 보고서의 "백업 완료"는 코드 한정입니다.**

## 5. 비밀/고객정보 취급
- 번들·보고서·브랜치에 **비밀 키/토큰 없음**(CODEF 키 등은 Supabase 시크릿에만 존재, 소스에 없음).
- **실제 고객 원본(PDF/주민번호/진료 JSON) 없음** — 저장소에 포함하지 않음. 구현에는 **합성(DEMO) fixture**만 사용.

## 6. 다음 단계(백업 이후)
- 작업 브랜치: `claude/manager-contacts-excel-upload-8jd6u0` (= `origin/main` 기준으로 리셋, 기존 변경 보존).
- SJ CLAIM FINDER 통합 구현 → typecheck/build/핵심 테스트 → **리뷰용 PR(미병합)**. main 병합/배포·운영 DB 변경·유료가입·새 외부서비스 **하지 않음.**
