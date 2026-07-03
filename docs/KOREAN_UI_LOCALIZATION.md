# Korean UI Localization — SJ OS

SJ OS is a Korean CEO/operator product. **All user-facing UI text is Korean.**
Internal code identifiers stay English. This document is the standard for keeping
the two separated as the app grows.

---

## 1. Principle: translate the surface, not the code

- **User-facing text → Korean.** Anything a CEO/operator reads on screen: page
  titles, subtitles, card headers, button labels, placeholders, empty-state
  messages, tooltips (`aria-label`), status/mode display labels, and the display
  `label` / `title` / `summary` / `detail` values of metadata objects.
- **Internal identifiers → English (unchanged).** Never translate:
  - object property **keys**, especially `Record<'status', ...>` keys
  - enum / union values, and any string compared with `===` or in a `switch`
  - route/view `name` values, service IDs, worker IDs, data/mock keys
  - React `key=` values derived from ids, `className` / Tailwind classes
  - import paths, component/function/variable/type names, icon names
  - code comments and `console` logs (developer-facing, left English)

> Rule of thumb: if a string is **both** displayed and used as a key/comparison,
> leave it English and add a separate display label. A static Korean string used
> only as a React `key=` is fine (still unique and stable).

This sprint did **not** introduce a full i18n framework. It is a direct Korean
UI cleanup. A `displayLabel` helper may be added later only where a value must
stay an English key but needs a Korean label for display.

---

## 2. Product naming conventions

| English | Korean (UI) |
| --- | --- |
| SJ AI Company | SJ AI 컴퍼니 |
| AI Company OS | AI 회사 운영체제 |
| Jarvis | 자비스 |
| Autopilot | 오토파일럿 |
| Development OS | 개발 OS |
| PM Planner | PM 플래너 |
| CTO Room | CTO 룸 |
| Approval Center | 승인 센터 |
| QA Center | QA 센터 |
| Release Center | 릴리즈 센터 |
| DevOps Center | DevOps 센터 |
| Live Company | 라이브 컴퍼니 |
| Universal App Builder | 범용 앱 빌더 |
| Developer Command Center | 개발 명령 센터 |
| Executive Assistant | 경영 비서 |
| Chief of Staff | 비서실장 |

### Common UI terms

| English | Korean |
| --- | --- |
| Command input | 명령 입력 |
| Assistant response | 자비스 응답 |
| Recent commands | 최근 명령 |
| Conversation history | 대화 기록 |
| Suggested commands | 추천 명령 |
| Execution status | 실행 상태 |
| Tool calls | 도구 호출 |
| Status / Mode | 상태 / 모드 |
| Completed / Pending / Failed | 완료 / 대기 / 실패 |
| Ready / Blocked / In progress | 준비됨 / 차단됨 / 진행 중 |
| Approval required | 승인 필요 |
| Risk level | 위험도 |
| Target workspace | 대상 워크스페이스 |
| Generated prompt / Copy prompt | 생성된 프롬프트 / 프롬프트 복사 |
| Next action | 다음 작업 |
| App Builder | 앱 빌더 |
| AI Tool Plan / Sprint Plan | AI 도구 계획 / 스프린트 계획 |
| Required Modules / Suggested Screens / Data Models | 필요 모듈 / 추천 화면 / 데이터 모델 |

---

## 3. Terms kept in English (readability)

Brand and widely-understood technical terms stay as-is, even inside Korean
sentences, because Korean operators read them natively:

`FC OS`, `DevOps`, `QA`, `API`, `GPT`, `OpenAI`, `Claude Code`, `Gemini`,
`Canva`, `Gamma`, `Kling`, `Notion`, `Suno`, `PM`, `CTO`, `SJ OS`, `CI/CD`,
`PR`, `git`, `Electron`.

---

## 4. Where localization was applied

- **Chrome:** sidebar navigation labels, topbar titles/subtitles, Jarvis open
  button.
- **Jarvis panel:** card titles, status/mode badges, GPT status labels, empty
  states, conversation roles, Universal App Builder result card. (Voice-mode
  card text was intentionally **not** touched — voice is paused this sprint.)
- **Pages:** Command Center, Universal App Builder, and every workspace/center
  page (FC OS, Customer, Sales Activity, Schedule, Performance, Team Leader,
  Consultation, Insurance Analysis, Development OS, PM Planner, CTO Room,
  Approval Center, QA Center, Release Center, DevOps Center, Live Company,
  Autopilot, Workers, Projects, Product Backlog, Activity Log, Settings).
- **Components:** dashboard, worker, and kernel component text.

---

## 5. Guidance for future changes

- Add new UI text in Korean from the start; follow the tables above.
- Keep new enum/status/route values English; expose a Korean display label
  separately if the value is shown.
- Do not rename existing identifiers to "match" Korean copy — that risks
  breaking routes and logic. Localization is a display concern only.
