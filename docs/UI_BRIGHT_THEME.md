# SJ OS Bright Theme + Premium Jarvis

SJ OS was reskinned from a dark, developer/admin look to a **bright, clean,
staff-facing insurance-office** experience, while making **Jarvis** the visually
premium signature feature. Business logic, navigation, and features are unchanged
— this is a visual/UX layer only.

## How the whole app flipped to light (no per-page rewrite)

The app is styled almost entirely with the Tailwind `slate` gray scale and a few
accent families. Instead of editing 25+ pages, the theme is flipped by **remapping
the color tokens** in `tailwind.config.js`:

- **`slate` is inverted to a light ramp** — `bg-slate-950/900` now resolve to the
  soft blue-white app background and white surfaces, and `text-slate-100/200/300`
  resolve to dark navy/charcoal text. Visual hierarchy (which shade is more
  prominent) is preserved, so every page becomes a coherent light layout with no
  markup changes.
- **Accent text shades (100–400) are darkened** for each family (indigo, violet,
  emerald, amber, rose, sky, fuchsia, cyan, orange, teal, blue, green). Pale
  shades like `text-indigo-300` — designed for dark backgrounds — become readable
  vivid values on white, while the fill/border shades (`bg-*-500/10`,
  `border-*-500/20`, `bg-*-600`) are kept so chips and badges stay legible.
- A `brand` palette (`blue`, `indigo`, `gold`) is available for premium accents.

`index.css` switches `color-scheme` to light and adds light scrollbars + a blue
selection color.

### Palette

| Role | Value |
| --- | --- |
| App background | soft blue-white gradient (`#eef3fb → #f5f8fd → #e9eff9`) |
| Surfaces | white cards with a soft shadow |
| Primary accent | blue / indigo (`#2563eb` / `#4f46e5`) |
| Secondary accent | gold (`#d4a72c`) |
| Success | emerald, Warning | amber, Danger | rose |
| Text | dark navy / charcoal |

## Shell polish

- **Sidebar** — white surface, gradient logo tile, and a clear **blue gradient
  pill** for the active item (with white icon/label). Friendlier labels
  (`보험 업무 플랫폼`).
- **Topbar** — frosted white bar; the 자비스 button is a premium blue→violet
  gradient pill with a gold sparkle.
- **Cards** (`components/ui/Card`) — white, rounded-2xl, soft shadow for clear
  grouping and hierarchy.
- **CEO dashboard hero** — converted to a vivid blue→violet banner (was a broken
  dark gradient), with readable metric values.

## Premium Jarvis

Jarvis is deliberately the most striking surface in the app:

- **Dark, blurred scrim** behind the panel so the bright app recedes and Jarvis
  pops.
- **Elevated panel** — rounded-3xl, indigo-tinted shadow + ring.
- **Control-center header** — soft indigo→violet gradient bar with a glowing,
  pulsing gradient **AI Core badge**, an `AI Core` wordmark, and friendly Korean
  subtitle (`AI 업무 어시스턴트 · 명령 · 분석 · 실행`).
- **Enhanced AI Core orb** — larger, layered halos (radial aura + pulse ring +
  mid ring + breathing halo) and a glossy core with a specular highlight. Colors
  track state: idle / listening (`듣는 중`) / transcribing (`전사 중`) / analyzing /
  planning / prompting / complete.
- **Structured results** — command timeline, status chips, and result cards keep
  the analysis → execution → result flow clear.

## Safe scope

- UI/UX + token remap only; no architecture change, no STT backend work, no new
  APIs, no secrets.
- Universal App Builder, Developer Prompt Center, and all Insurance OS pages are
  preserved and simply inherit the bright theme.
- Reversible: restoring the original `tailwind.config.js` returns the dark theme.
