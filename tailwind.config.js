/** @type {import('tailwindcss').Config} */

/**
 * SJ OS bright, staff-facing theme.
 *
 * The whole app was originally styled with the dark `slate` scale (dark
 * backgrounds + light text). Rather than rewrite every page, we remap the color
 * TOKENS the app already uses:
 *
 *  - `slate` is inverted to a light ramp, so `bg-slate-950/900` become the app
 *    background / white surfaces and `text-slate-100/200/300` become dark,
 *    readable navy/charcoal text. This flips the entire app to a bright,
 *    finance-office feel with no per-page churn.
 *  - Each accent family's pale text shades (100–400, e.g. `text-indigo-300`)
 *    are darkened to a readable-on-white value, while the vivid fill/border
 *    shades (500/600/700) are kept, so status chips and badges stay legible on
 *    light surfaces.
 *
 * All business logic is untouched — this is purely a visual token remap.
 */

// Readable-on-light overrides for an accent family: darken the pale 100–400
// shades (used as text/icons on dark) to the vivid 600/700 values.
const readable = (c600, c700) => ({ 100: c700, 200: c700, 300: c600, 400: c600 })

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Inverted gray ramp → bright theme. Higher numbers = lighter surfaces,
        // lower numbers = darker text (mirrors how the app already uses them).
        slate: {
          50: '#0b1120',
          100: '#0f1a2e',
          200: '#1e293b',
          300: '#334155',
          400: '#4b5a72',
          500: '#64748b',
          600: '#94a3b8',
          700: '#cbd5e1',
          800: '#e2e8f0',
          900: '#ffffff',
          950: '#f5f8fd'
        },
        indigo: readable('#4f46e5', '#4338ca'),
        violet: readable('#7c3aed', '#6d28d9'),
        emerald: readable('#059669', '#047857'),
        amber: readable('#d97706', '#b45309'),
        rose: readable('#e11d48', '#be123c'),
        sky: readable('#0284c7', '#0369a1'),
        fuchsia: readable('#c026d3', '#a21caf'),
        cyan: readable('#0891b2', '#0e7490'),
        orange: readable('#ea580c', '#c2410c'),
        teal: readable('#0d9488', '#0f766e'),
        blue: readable('#2563eb', '#1d4ed8'),
        green: readable('#16a34a', '#15803d'),
        // Named brand accents for the premium Jarvis + primary surfaces.
        brand: {
          blue: '#2563eb',
          indigo: '#4f46e5',
          gold: '#d4a72c'
        }
      }
    }
  },
  plugins: []
}
