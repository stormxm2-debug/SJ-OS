// E2E 하네스 빌드: ClaimFinderPage + 합성 어댑터를 iife 로 번들하고,
// 앱의 실제 컴파일 CSS(dist/assets/index-*.css)를 인라인해 자기완결 HTML 을 만든다.
// (실제 Tailwind 반전 slate 팔레트를 써야 대비 검사가 운영과 동일해진다.)
import { build } from 'esbuild'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const fx = (name) => join(here, 'fixtures', `${name}.ts`)

export async function buildHarness() {
  const result = await build({
    entryPoints: [join(here, 'harness-entry.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      // 합성 어댑터로 치환(운영 서비스 미사용). 가장 구체적인 별칭이 우선.
      '@renderer/services/commercial/healthRecordService': fx('healthRecordService'),
      '@renderer/services/commercial/coverageAnalysis': fx('coverageAnalysis'),
      '@renderer/services/commercial/customerService': fx('customerService'),
      '@renderer/services/insurance-claim/policyTermsService': fx('policyTermsService'),
      '@renderer/services/insurance-hub/insuranceHubStore': fx('insuranceHubStore'),
      '@renderer/services/claim-finder/pdfExtractor': fx('pdfExtractor'),
      '@renderer/services/claim-finder/claimFinderStore': fx('claimFinderStore'),
      // 나머지 claim-finder 엔진/어댑터/페이지는 실제 코드 사용.
      '@renderer': join(repo, 'src/renderer/src'),
      '@shared': join(repo, 'src/shared')
    }
  })
  const js = result.outputFiles[0].text

  // 실제 앱 CSS 인라인(없으면 build:web 먼저 실행 필요).
  const assetsDir = join(repo, 'dist/assets')
  const cssFile = readdirSync(assetsDir).find((f) => /^index-.*\.css$/.test(f))
  if (!cssFile) throw new Error('dist/assets/index-*.css 없음 — 먼저 `npm run build:web` 실행')
  const css = readFileSync(join(assetsDir, cssFile), 'utf8')

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>body{margin:0;padding:12px;background:#fff}</style>
</head><body><div id="root"></div><script>${js}</script></body></html>`

  const outDir = join(here, 'dist')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'index.html')
  writeFileSync(outFile, html, 'utf8')
  return outFile
}

// 직접 실행 시 빌드만 수행.
if (process.argv[1] && process.argv[1].endsWith('build-harness.mjs')) {
  buildHarness().then((f) => console.log('harness:', f)).catch((e) => { console.error(e); process.exit(1) })
}
