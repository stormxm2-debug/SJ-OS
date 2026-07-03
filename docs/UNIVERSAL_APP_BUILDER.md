# Universal App Builder — SJ OS

SJ OS is **no longer an insurance-only system.** With the Universal App Builder
foundation, the CEO can ask Jarvis to plan and build **any business system** —
ecommerce, education, hospital reservation, real estate, marketing/content
automation, internal dashboards, and more — while the existing insurance OS
(FC OS, Customer Workspace, Sales Activity, Schedule, Performance, Team Leader,
Consultation, Insurance Analysis) stays fully intact.

> SJ OS can build insurance systems, ecommerce systems, marketing systems, and
> internal company OS tools.

---

## 1. What it does

When the CEO types a build command to Jarvis, SJ OS turns it into a structured,
locally-planned **app-building project** — no external API, no keys, no file
edits, no git. Everything is local-first (mock) and safe.

Example commands:

- `쇼핑몰 시스템 만들어`
- `학원 관리 프로그램 만들어`
- `병원 예약 시스템 만들어`
- `상세페이지 자동 제작 시스템 만들어`
- `AI 영상 광고 제작 시스템 만들어`
- `Canva랑 Gamma랑 연결해서 제안서 자동 생성하게 해`

Each becomes a `UniversalBuildProject` with:

- interpreted goal + app type + industry + target users
- required modules, suggested screens, suggested data models
- suggested integrations + an **AI-tool orchestration plan**
- a 3-sprint delivery plan
- risk level + approval requirement
- a **Claude Code-ready developer prompt**

The project is then routed into the existing development operating system:
a **PM Planner** backlog item is created, an **Approval Center** request is
raised when approval is required, and a **Development OS** event is recorded.
**Autopilot** surfaces the pending build-project count (read-only).

---

## 2. Command classification

Jarvis's local `IntentClassifier` (rule-based, no AI) detects whole-system build
commands **before** implementation and GPT markers, so a "build me a system"
command is never mistaken for a small feature request.

Detected phrases include: `시스템 만들어`, `프로그램 만들어`, `앱 만들어`,
`플랫폼 만들어`, `쇼핑몰`, `예약 시스템`, `관리 프로그램`, `자동 제작`,
`자동화 시스템`, `랜딩페이지`, `상세페이지`, `영상 광고`, `제안서 자동 생성`.

Build commands route to:

- **mode:** `universal-build` (intent `universal-build-command`)
- **source:** Jarvis Universal App Builder

A bare feature request like `FC OS에 팀별 필터 만들어` still routes to the normal
**implementation-request** mode, and existing local commands (`오늘 일정`,
`유튜브 켜줘`, `오토파일럿 열어줘`, `FCOS`) are unchanged.

---

## 3. Supported app types

`ecommerce` · `crm` · `education` · `hospital-reservation` · `real-estate` ·
`insurance` · `marketing-automation` · `content-production` ·
`internal-dashboard` · `custom`

Unknown/ambiguous commands map to `custom`: the planner asks **no blocking
question** — it produces a reasonable first plan and clearly marks its
assumptions.

## Project lifecycle statuses

`captured` → `interpreted` → `planned` → `needs-approval` → `approved` →
`prompt-generated` → `sent-to-claude` → `in-development` → `completed`
(plus `blocked`, `rejected`).

---

## 4. Universal Planning Engine

For each build command the engine generates a deterministic, local plan. For
example, **ecommerce** produces:

- **Modules:** product management, category management, cart, order management,
  customer management, payment placeholder, shipping placeholder,
  coupon/promotion, admin dashboard, analytics
- **Screens:** dashboard, product list, product detail, cart, order list,
  customer list, promotion manager, settings
- **Data models:** Product, Category, Customer, Order, OrderItem, Payment,
  Shipment, Coupon

**Content / marketing automation** produces: campaign brief, content calendar,
design request, video request, landing page, asset library, approval workflow.

**Education** produces: student management, class management, attendance,
payment, consultation, schedule, teacher dashboard.

Each project also gets a 3-sprint plan: Sprint 1 (Foundation — data models +
core CRUD), Sprint 2 (Experience — screens + flows), Sprint 3 (AI-tool
integration placeholders + approval flow).

---

## 5. AI Tool Connector Registry

A local catalogue of external AI tools SJ OS can **plan** to orchestrate. These
are **planned adapters, not active integrations** — no entry calls a real API in
this foundation. Each tool records its official-API status and required
credentials so the CEO/CTO can verify and activate it **per tool, later,** with
explicit approval.

| Tool | Category | Official API | Purpose |
| --- | --- | --- | --- |
| OpenAI | llm | official | reasoning, copywriting, planning, STT/TTS if configured |
| Gemini | llm | official | alternative LLM, multimodal analysis, image/video understanding |
| Claude Code | code | official | code implementation, refactor, verification, commit |
| Canva | design | uncertain | design assets, banners, social creatives, detail pages, brand templates |
| Gamma | document | uncertain | presentations, proposals, documents, landing-style content |
| Kling | video | uncertain | AI video/image generation |
| Notion | knowledge | official | project docs, databases, task boards, knowledge base |
| Suno | audio | uncertain | music/audio generation (official API status uncertain until verified) |

**No API keys live in the renderer/frontend.** Any real integration keeps its
key in the Electron main process or a backend, never in the UI.

---

## 6. Tool Orchestration Planner

When a build project is created, SJ OS suggests which AI tools should be used
and what each is responsible for. Every project gets **Claude Code** (build) +
**OpenAI** (plan/write) + **Notion** (docs); the rest are added by app type and
command keywords. Examples:

- `쇼핑몰 시스템 만들어` → Claude Code (modules), OpenAI (copy/logic/planning),
  Canva (banners/detail pages), Notion (plan/tasks), Gamma (sales proposal).
- `AI 영상 광고 제작 시스템 만들어` → OpenAI (script/brief), Kling (video),
  Canva (thumbnails/assets), Suno (background music — after official
  integration), Notion (campaign board).
- `제안서 자동 생성` → OpenAI (proposal content), Gamma (deck/document),
  Canva (visual assets), Notion (client/project database).

---

## 7. Developer Prompt Generator

Every project produces a **Claude Code-ready developer prompt** the CEO can
paste to start real development. It includes: mission, app type, interpreted
goal, modules, screens, data models, AI-tool **integration placeholders**,
safety rules, verification commands (`npm run typecheck`, `npm run build`), git
commands, and a commit message.

The generated prompt contains **no API keys** and does **not** require any real
external AI integration in the first pass unless explicitly approved — external
tools appear only as clearly-marked placeholders.

---

## 8. Where to find it

- **Jarvis** (Ctrl + Space): type a build command; the result shows app type,
  goal, modules, screens, data models, AI-tool plan, sprint plan, risk, approval
  state, and the generated prompt with a **copy** action.
- **App Builder page** (sidebar → *App Builder*): recent build projects, per-
  project detail, generated prompt, and the AI Tool Connector Registry.
- **Autopilot**: a read-only *Universal App Builder Queue* card with the pending
  project count.

---

## 9. Safety & activation rules

- Local-first (mock) — no external API calls in this foundation.
- No OpenAI (or any) key required. No `.env` / `.env.local` committed.
- API keys never live in the renderer/frontend.
- External AI tools are **planned adapters**, not all active yet.
- Each tool's **official API / key status must be verified per tool** before it
  is activated, and activation goes through the Approval Center.
- The existing insurance OS is preserved and untouched.
