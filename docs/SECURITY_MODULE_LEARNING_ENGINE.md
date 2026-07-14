# 자동 보안 모듈 탐지 및 학습 엔진 — 설계서

SJ 보험전산 관리센터의 **자동 보안 모듈 탐지 및 학습 엔진(Security Module Learning Engine, "SMLE")** 설계 문서.
구현에 앞서 전체 아키텍처, 데이터 구조, 탐지 알고리즘, 신뢰점수 계산, 분류 체계, 의존성 그래프,
자동 전환, 안전장치, 롤백 구조를 확정한다.

> **핵심 원칙:** 사용자는 프로세스·서비스·드라이버·시작 프로그램을 **직접 확인하거나 등록하지 않는다.**
> 엔진이 보험사 전산 실행 전후의 Windows 상태 변화를 **자동 추적·학습**한다.
> 1차 구현은 **관찰·학습 전용**이며 어떤 프로세스도 종료하지 않는다. 자동 제어는 신뢰점수가
> 충분히 축적된 뒤 별도 단계에서 활성화한다.

---

## 1. 목표와 범위

### 1.1 무엇을 하는가
1. 보험사 전산 프로그램 실행 **직전 스냅샷**과 **실행 후 스냅샷**을 자동 비교한다.
2. 새로 생성되거나 상태가 바뀐 프로세스·서비스·드라이버·예약 작업·시작 프로그램·네트워크 연결을 수집한다.
3. **반복 실행 데이터**로 각 요소를 보험사별로 자동 분류하고 신뢰점수를 부여한다.
4. 보험사별 **의존성 그래프**를 만든다.
5. (후속 단계) 신뢰점수가 높은 요소만 자동 실행/자동 종료 대상으로 승격해 **모드 전환**을 자동화한다.

### 1.2 무엇을 하지 않는가 (1차 범위)
- **프로세스/서비스/드라이버를 종료하지 않는다.** 제어 계층은 설계·스텁만 두고 비활성(`disabled`) 상태로 둔다.
- 사용자에게 프로세스 확인/분류를 요구하지 않는다. 전 과정 자동.
- 개인정보·공동인증서 내용·비밀번호·고객정보를 로그나 저장소에 남기지 않는다.
- 외부 유료 프로그램에 의존하지 않는다. Windows 기본 제공 수단만 사용한다.

### 1.3 실행 환경
- Electron **메인 프로세스(Node)** 에서만 동작한다. 렌더러(UI)는 IPC를 통해 읽기 전용 상태만 받는다.
- Windows 전용. macOS/Linux에서는 수집기가 `unsupported`를 반환하고 UI는 안내만 표시한다.

---

## 2. 데이터 수집원 (외부 유료 도구 없이)

| 수집 대상 | 1차 수단(무료·기본 제공) | 향후 강화 |
|---|---|---|
| 실행 프로세스, 부모·자식 관계 | `Get-CimInstance Win32_Process` (ProcessId, ParentProcessId, ExecutablePath, CommandLine) | ETW `Microsoft-Windows-Kernel-Process` |
| 실행 경로·명령줄 | 위와 동일 | — |
| 실행파일 해시 | `Get-FileHash -Algorithm SHA256` (변경분에만) | — |
| 디지털 서명 유효/게시자 | `Get-AuthenticodeSignature` (변경분에만) | — |
| 서비스 시작·중지 변화 | `Get-CimInstance Win32_Service` (State, StartMode, PathName) | SCM 이벤트, `Service Control Manager`(System 로그 7036) |
| 서비스 시작 유형·종속성 | `Win32_Service.StartMode`, `Win32_DependentService` 관계 | — |
| 드라이버 로드 이벤트 | `Get-CimInstance Win32_SystemDriver` (State, Started) | ETW 드라이버 로드, Sysmon Event 6 |
| 시작 프로그램 | `Win32_StartupCommand`, Run 레지스트리 키 | — |
| 예약 작업 | `Get-ScheduledTask` / `schtasks` | — |
| 브라우저 프로필·실행 URL | 보험사 전산이 띄운 브라우저 프로세스의 CommandLine 인자에서 프로필·URL 추출(개인 URL은 저장 안 함, 3.6 참고) | — |
| 파일·레지스트리 변경 | (후속) Sysmon Event 11/12/13, ETW | — |
| 네트워크 연결 | `Get-NetTCPConnection` (OwningProcess, RemoteAddress, RemotePort) | ETW `Microsoft-Windows-Kernel-Network` |
| 전산 종료 후 잔존 | 종료 스냅샷을 baseline과 비교 | — |

**Sysmon / Windows 이벤트 로그 / ETW / WMI-CIM / SCM 우선순위**
- 기본 경로는 **WMI/CIM + PowerShell 내장 cmdlet**이다. 어떤 Windows에도 존재하고 설치가 필요 없다.
- **Sysmon**이 설치되어 있으면(무료, Microsoft Sysinternals) `Microsoft-Windows-Sysmon/Operational` 이벤트 로그를
  추가 신호로 사용한다. 없으면 조용히 건너뛴다. Sysmon 설치를 강제하지 않는다.
- **ETW/Windows 이벤트 로그**는 파일·레지스트리·드라이버 세밀 추적이 필요한 후속 단계에서 `Get-WinEvent`로 붙인다.
- 모든 수집은 **고정된(renderer 입력이 섞이지 않는) PowerShell 스크립트**로 실행한다. 명령 인젝션 표면이 없다.

---

## 3. 데이터 구조

모든 타입은 `src/shared/securityLearning.ts`에 정의한다(메인·렌더러 공용, Node 의존성 없음).

### 3.1 스냅샷
```
SystemSnapshot {
  id: string
  takenAt: string            // ISO
  phase: 'baseline' | 'after-launch' | 'after-exit' | 'periodic'
  insurerId: string | null   // 이 스냅샷이 어떤 보험사 세션에 속하는지
  processes: ProcessEntry[]
  services: ServiceEntry[]
  drivers: DriverEntry[]
  scheduledTasks: ScheduledTaskEntry[]
  startupItems: StartupEntry[]
  network: NetworkConnEntry[]
  collectorErrors: string[]  // 수집 중 부분 실패(권한 등)
}
```
경량 원칙: baseline/after 스냅샷은 **해시·서명 없이** 빠르게 찍는다. 해시·서명은 diff로 걸러진 **변경분에만** 부여한다(2장 표).

각 엔트리의 키(안정 식별자, `identityKey`):
- Process: `path|name`(경로 소문자 정규화). PID는 매 실행 달라지므로 식별자에 쓰지 않는다.
- Service: `serviceName`
- Driver: `driverName`
- ScheduledTask: `taskPath\taskName`
- Startup: `location|command`
- Network: `remoteAddress:remotePort|ownerPath`(원격 종단점 기준, 개인 세션 URL은 제외)

### 3.2 스냅샷 diff
```
SnapshotDiff {
  insurerId: string
  baselineId: string
  afterId: string
  appeared: DiffItem[]   // baseline에 없고 after에 있음
  changed: DiffItem[]    // 양쪽에 있으나 상태(State/StartMode 등) 변경
  disappeared: DiffItem[]// baseline에 있고 after에 없음(주로 종료 diff에서 사용)
}
DiffItem {
  kind: ElementKind      // 'process'|'service'|'driver'|'scheduled-task'|'startup'|'network'
  identityKey: string
  label: string          // 표시용 이름
  detail: ElementDetail  // 경로·명령줄(정제됨)·게시자·서명유효·해시·상태 등
}
```

### 3.3 학습 요소 (누적)
반복 실행에 걸쳐 누적되는 **보험사별 학습 단위**.
```
LearnedElement {
  id: string
  insurerId: string
  kind: ElementKind
  identityKey: string
  label: string
  detail: ElementDetail

  observations: number        // 이 보험사 실행 시 등장 횟수
  sessionsSeen: number        // 등장한 서로 다른 세션 수
  totalSessions: number       // 이 보험사 전체 학습 세션 수
  lastSeenAt: string
  firstSeenAt: string
  sharedWithInsurerIds: string[] // 다른 보험사 세션에서도 관찰된 경우

  signatureValid: boolean | null
  publisher: string | null
  sha256: string | null

  category: ElementCategory
  categoryReasons: string[]   // 왜 이렇게 분류했는지(내부 근거 로그)
  confidence: number          // 0..1
  controlEligible: boolean    // 자동 제어 승격 여부(신뢰점수·안전기준 통과)
  protectedReasons: string[]  // 종료 금지 사유(있으면 controlEligible=false)
}
```

### 3.4 분류 체계 (ElementCategory)
| 값 | 의미 | 자동 종료 |
|---|---|---|
| `insurer-exclusive` | 해당 보험사 전용 | 후속 단계에서 대상(안전기준 통과 시) |
| `insurer-shared` | 여러 보험사 공용(키보드 보안·인증 모듈 등) | **사용하는 보험사가 하나도 없을 때만** |
| `windows-system` | Windows 시스템 구성요소 | **금지** |
| `security-av` | 백신·방화벽·보안 | **금지** |
| `business-common` | 업무 일반 프로그램(오피스·브라우저 등) | **금지**(사용자 작업 보호) |
| `unknown` | 소속 불명 | 제외(계속 학습) |
| `never-terminate` | 자동 종료 금지(안전규칙 고정) | **금지** |

### 3.5 보험사 프로필 + 의존성 그래프
```
InsurerProfile {
  id: string          // 예: 'A','C','D' — 사용자가 모드로 고르는 대상
  name: string
  launchHints: string[]        // 이 보험사 전산 실행파일로 관찰된 경로들
  totalSessions: number
  lastSessionAt: string | null
}
DependencyGraph {
  insurerId: string
  nodes: LearnedElement[]      // category별로 그룹핑해 UI에서 렌더
  edges: DependencyEdge[]      // process→child, service→dependent-service, process→driver 등
}
DependencyEdge { fromKey: string; toKey: string; relation: 'parent-child'|'service-dependency'|'loads-driver'|'uses-shared' }
```
예시(보험사 A):
전산 실행파일 → 브라우저 프로필 → 전용 보안 프로세스 → 공용 키보드 보안 → 인증서 모듈 → Windows 서비스 → 드라이버 → 예약 작업.

### 3.6 개인정보 비저장 규칙 (필수)
- 명령줄(CommandLine)은 저장 전 **정제(redact)** 한다.
  - `password=`, `pw=`, `pwd=`, `token=`, `secret=`, `cert`, `인증서`, 주민번호 패턴(`\d{6}-\d{7}`),
    이메일, 세션/쿼리 문자열 값 등을 `***`로 치환한다.
  - 브라우저 URL은 **호스트(도메인)만** 보관하고 경로·쿼리는 버린다.
- 파일 내용, 공동인증서 파일 내용, 비밀번호, 고객정보는 **어떤 형태로도 저장하지 않는다.**
- 저장소에는 경로·해시·게시자·서명유효·상태 등 **분류에 필요한 최소 메타데이터만** 남긴다.

---

## 4. 탐지 알고리즘

### 4.1 세션 수명주기
```
1) beginSession(insurerId)
   - baseline 스냅샷 수집(경량). 세션 시작 기록.
2) (사용자가 보험사 전산 실행)
3) captureAfterLaunch(sessionId)
   - after-launch 스냅샷 수집.
   - diff = diffSnapshots(baseline, after)
   - diff.appeared/changed의 실행파일에 대해서만 해시·서명 enrich.
   - mergeIntoLearning(insurerId, diff)  // 관찰 누적 + 재분류 + 신뢰점수 갱신
4) (선택) periodic 스냅샷으로 지연 로딩되는 드라이버/서비스 추적
5) endSession(insurerId)
   - after-exit 스냅샷 → baseline과 비교해 "종료 후 잔존" 요소 식별(잔존 플래그만 기록, 종료하지 않음)
```

### 4.2 diff 규칙
- `appeared`: baseline `identityKey` 집합에 없고 after에 있는 항목.
- `changed`: 양쪽에 있으나 `State`(서비스/드라이버) 또는 `StartMode`가 바뀐 항목.
- 노이즈 억제: 잘 알려진 Windows 상시 프로세스(svchost, RuntimeBroker 등 변동성 큰 목록)는 diff에서 **관찰은 하되 신뢰점수 가중은 낮춘다**(4.4).

### 4.3 반복 실행 기반 분류 (한 번으로 확정하지 않음)
각 `LearnedElement`에 대해 매 세션 관찰을 누적한 뒤 아래 순서로 category를 결정한다(위에서 아래로, 먼저 걸리는 규칙 채택):

1. **`never-terminate`** — 안전규칙에 걸리면(§6 보호 목록) 무조건 여기. `protectedReasons` 채움.
2. **`windows-system`** — 게시자가 `Microsoft Windows`/서명 유효 + 경로가 `C:\Windows\`, 또는 알려진 코어 프로세스명.
3. **`security-av`** — 게시자/이름이 알려진 백신·방화벽 벤더 목록에 매칭(AhnLab, ESTsecurity/ALYac, 안랩, Windows Defender, V3, Symantec, McAfee, Kaspersky, 하우리 등).
4. **`insurer-shared`** — 서로 다른 **2개 이상 보험사** 세션에서 관찰됨(`sharedWithInsurerIds.length >= 1` 이고 현재 보험사 포함 총 2개↑). 키보드 보안(예: TouchEn, Veraport, nProtect, Delfino, ASTx, IPinside 등 공용 모듈 힌트)도 강한 신호.
5. **`business-common`** — 오피스/브라우저/일반 업무 프로그램 게시자 목록 매칭.
6. **`insurer-exclusive`** — 특정 보험사 세션에서만 반복 관찰(`sessionsSeen/totalSessions` 비율 높음) 되고 다른 보험사에서 안 보임.
7. 그 외 → **`unknown`**.

분류 근거는 모두 `categoryReasons`에 문자열로 남긴다(사용자 노출 불필요, 내부 로그/디버그용).

### 4.4 신뢰점수(confidence) 계산
0..1 범위. 가중합을 `clamp(0,1)`.

```
base = 0
// (a) 반복성: 자주·여러 세션에서 보일수록↑
base += 0.40 * min(1, sessionsSeen / REPEAT_TARGET)          // REPEAT_TARGET=3
base += 0.10 * min(1, observations / (REPEAT_TARGET * 2))
// (b) 소속 선명도: 특정 보험사에 강하게 종속될수록↑
base += 0.20 * exclusivityRatio                              // sessionsSeen/totalSessions
// (c) 신원 신뢰: 서명 유효 + 게시자 식별
base += signatureValid === true ? 0.15 : (signatureValid === false ? 0.00 : 0.05)
base += publisher ? 0.05 : 0
// (d) 안정적 식별자(고정 경로) 가산
base += hasStablePath ? 0.05 : 0
// (e) 노이즈 감점: 변동성 큰 시스템 호스트 프로세스
base -= isNoisyHost ? 0.20 : 0
confidence = clamp(0,1, base)
```

`controlEligible`(자동 제어 승격) 조건 — **모두** 충족해야 함:
- `confidence >= CONTROL_THRESHOLD` (초기 0.80, 보수적)
- `sessionsSeen >= REPEAT_TARGET` (최소 3세션 관찰)
- `category ∈ { insurer-exclusive, insurer-shared }` (종료가 의미 있는 범주만)
- `protectedReasons`가 비어 있음(§6 보호규칙 미해당)
- `signatureValid !== false` (위조/무효 서명은 승격 금지)

승격되지 못한 항목은 **자동 종료 대상에서 제외**한 채 계속 학습한다(사용자 확인을 요구하지 않는다).

---

## 5. 자동 전환 (후속 단계 — 설계만, 1차 비활성)

사용자가 `C`·`D` 전산 모드를 선택하면:
1. **실행:** 대상 보험사의 `controlEligible` 전용 요소 + 필요한 공용 요소를 자동 실행/보장한다.
2. **정리 종료:** 대상과 무관한 **다른 보험사 전용** 요소만 안전 종료한다.
3. **공용 보호:** 다른 실행 중 보험사가 사용하는 공용 요소는 종료하지 않는다.
4. **종료 시:** 해당 보험사 전용 요소만 종료. 공용 요소는 **참조하는 보험사가 0일 때만** 종료.
5. **브라우저:** 창만 닫지 않고 관련 프로세스·서비스 잔존 여부를 검사한다.
6. **정상 종료 우선:** `CloseMainWindow`/서비스 stop 요청을 먼저, 제한시간(예: 8초) 초과 시에만 강제 종료 검토.

**공용 요소 참조 카운팅:** `sharedRefCount[elementKey] = 현재 실행 중이며 그 요소를 쓰는 보험사 수`.
0이 될 때만 공용 요소 종료 후보가 된다.

---

## 6. 안전장치 (강제)

아래는 **코드에서 하드 가드**로 강제한다. `evaluateProtection(element)`가 `protectedReasons`를 만들고, 하나라도 있으면 `controlEligible=false` 이며 자동 종료 경로에서 제외된다.

1. Microsoft/Windows 핵심 프로세스 종료 금지 — 코어 프로세스명 목록 + `C:\Windows\System32` + Microsoft 서명.
2. 백신·방화벽 자동 종료 금지 — `security-av` 카테고리 전부.
3. 서명·소속 불명확 드라이버 종료 금지 — `kind==='driver'` 이고 (`signatureValid!==true` 또는 `category==='unknown'`).
4. 저장되지 않은 Office 문서를 가진 프로세스 종료 금지 — 종료 직전 실시간 점검(Word/Excel/PPT 미저장 문서 감지 시 차단).
5. 실행 중 다른 보험사가 쓰는 공용 모듈 종료 금지 — §5 참조 카운팅.
6. 모든 변경 전 상태 스냅샷 저장 — 제어 실행 직전 `pre-change` 스냅샷 필수.
7. 실패 시 자동 복구 — 종료한 서비스/프로그램을 롤백(§7).
8. 무한 재시작 방지 / 최대 재시도 2회 / 자동 롤백 — §7.
9. 개인정보·인증서·비밀번호·고객정보 로그 미저장 — §3.6.
10. 보험사 업데이트로 실행파일 해시가 바뀌면 자동 재학습 — 해시 변경 감지 시 해당 요소 `observations` 재수집, `controlEligible` 일시 해제 후 재승격.

**추가 하드 가드**
- 애초에 종료 API 호출은 `controlEligible===true` 인 요소에만 도달할 수 있다(2중 확인: 승격 조건 + 종료 직전 재평가).
- 강제 종료(`taskkill /F`)는 정상 종료 실패 + 제한시간 초과 + 보호규칙 재확인 통과 시에만.

---

## 7. 롤백 구조

```
ChangePlan {
  id: string
  insurerId: string
  createdAt: string
  preChangeSnapshotId: string      // 변경 직전 상태
  actions: PlannedAction[]         // start/stop 목록(대상 요소, 이전 상태)
  attempts: number                 // 재시도 횟수(<= MAX_RETRIES=2)
  status: 'planned'|'applying'|'applied'|'rolling-back'|'rolled-back'|'failed'
}
PlannedAction {
  kind: ElementKind
  identityKey: string
  op: 'graceful-stop'|'force-stop'|'start'
  previousState: string            // 롤백 시 복원 목표
  result?: 'ok'|'failed'|'skipped'
}
```
절차:
1. 변경 전 `preChangeSnapshot` 저장.
2. 계획된 action을 순차 적용. 각 action은 정상 종료 우선, 제한시간 후 강제 종료.
3. 검증: 적용 후 스냅샷을 찍어 의도한 상태가 됐는지 확인.
4. 실패(핵심 요소가 죽거나 전산이 안 뜸) → **자동 롤백**: `previousState`로 서비스 재시작/프로그램 복원.
5. 재시도는 **최대 2회**. 초과 시 `failed`로 고정하고 더 이상 시도하지 않는다(무한 재시작 방지).
6. 롤백조차 실패하면 상태를 보존하고 정지(사용자 개입 없이 추가 파괴 금지).

멱등성: 모든 op는 현재 상태를 재확인 후 적용(이미 목표 상태면 `skipped`).

---

## 8. 시스템 아키텍처 (기존 구조 재사용)

```
renderer (UI, 읽기 전용)
  SecurityCenterPage  ── window.sj.securityLearning.* (IPC) ──►  main
                                                                  securityLearning.ts
main/securityLearning.ts (Node)
  - collectSnapshot(phase, insurerId)   // 고정 PowerShell 스크립트 실행·파싱
  - diffSnapshots / enrichChanged
  - LearningStore (userData/sj-os-security/learning.json 영속화)
  - session 수명주기 + emitter(state) → 모든 창에 broadcast
  - control layer: 1차에서는 disabled 스텁(§5/§6/§7 설계만)
shared/securityLearning.ts (순수 로직)
  - 타입 전체
  - classify(), computeConfidence(), evaluateProtection(), diff 순수 함수
  - 상수(임계값, 코어 프로세스, AV/공용 힌트 목록)
```
- 기존 패턴을 그대로 따른다: `main`이 모든 시스템 접근을 소유, `preload`가 타입 있는 `sj.securityLearning` 브리지 노출,
  렌더러는 IPC로만 접근. `spawnTool`/emitter/`app.getPath('userData')` 관례 재사용.
- 접근 권한: 센터 페이지는 **owner/admin 전용**(roleAccess).

### 8.1 IPC 표면(1차)
| 채널 | 방향 | 설명 |
|---|---|---|
| `sj-seclearn:status` | invoke | 지원 여부·세션 상태·요약 |
| `sj-seclearn:list-insurers` | invoke | 보험사 프로필 목록 |
| `sj-seclearn:begin-session` | invoke | baseline 스냅샷 후 세션 시작 |
| `sj-seclearn:capture-after` | invoke | after 스냅샷 + diff + 학습 병합 |
| `sj-seclearn:end-session` | invoke | 종료 스냅샷 + 잔존 분석 |
| `sj-seclearn:graph` | invoke | 보험사 의존성 그래프 |
| `sj-seclearn:learned` | invoke | 학습 요소 목록(+근거) |
| `sj-seclearn:state`(event) | main→renderer | 상태 변경 broadcast |

제어(실행/종료) 채널은 1차에서 노출하지 않는다. 후속 단계에서 승인 게이트와 함께 추가한다.

---

## 9. 단계별 구현 로드맵

- **1단계 (본 작업): 관찰·학습 전용.** 스냅샷/​diff/​분류/​신뢰점수/​영속화/​읽기 전용 UI. **종료 없음.**
- **2단계:** 신뢰점수 축적 후, `controlEligible` 요소에 대해서만 자동 실행/정리 종료 활성(§5) — 정상 종료 우선, 롤백(§7) 포함.
- **3단계:** ETW/Sysmon/이벤트 로그로 파일·레지스트리·드라이버 세밀 추적 강화, 브라우저 잔존 검사 정교화.

각 단계는 이전 단계 데이터를 리셋하지 않고 이어서 확장한다.
