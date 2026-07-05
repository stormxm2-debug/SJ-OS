import { app } from 'electron'
import { type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ReleaseSnapshot, SnapshotMeta } from '@shared/releaseSnapshot'
import { isValidSemver, isValidTagName, tagNameForVersion } from '@shared/releaseSnapshot'
import { spawnTool } from './claudeAutoBuild'

/**
 * Release snapshot / Git tag center (Electron MAIN only).
 *
 * SAFETY: runs ONLY these fixed git commands — `git rev-parse HEAD`, `git tag
 * --list`, `git status --short`, `git tag -a <vX.Y.Z> -m <fixed msg>`, and
 * `git push origin <vX.Y.Z>`. The tag name is DERIVED from package.json version
 * (never from the renderer). No `npm version`, no `-f`, no `--tags`, no
 * `--force`, no installer build, no publish. Args arrays only (no shell string).
 */

const ALLOWED_WORKSPACE_MAIN = 'C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS'

function mainWorkspace(): string {
  return resolve(app.getAppPath())
}
function sameWorkspace(a: string, b: string): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}
function nowIso(): string {
  return new Date().toISOString()
}

function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(mainWorkspace(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function runFixed(command: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolveP) => {
    let out = ''
    let child: ChildProcess
    try {
      child = spawnTool(command, args, { cwd: mainWorkspace(), windowsHide: true })
    } catch {
      resolveP({ code: -1, out: `${command} 실행 실패` })
      return
    }
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => resolveP({ code: -1, out: `${command} 실행 실패` }))
    child.on('close', (code) => resolveP({ code: code ?? -1, out }))
  })
}

// One current snapshot (per current package.json version).
let current: ReleaseSnapshot | null = null

async function tagExistsLocally(tag: string): Promise<boolean> {
  const res = await runFixed('git', ['tag', '--list', tag])
  return res.out.split(/\r?\n/).map((l) => l.trim()).includes(tag)
}

/** Read-only readiness inspection: version, tag name, commit, tag existence. */
export async function inspectTagReadiness(meta?: SnapshotMeta): Promise<ReleaseSnapshot> {
  const version = packageVersion()
  const tagName = tagNameForVersion(version)
  const validSemver = isValidSemver(version)
  const head = await runFixed('git', ['rev-parse', 'HEAD'])
  const commitHash = head.code === 0 ? head.out.trim().slice(0, 40) : ''
  const status = await runFixed('git', ['status', '--short'])
  const exists = validSemver ? await tagExistsLocally(tagName) : false

  const riskNotes: string[] = []
  if (!validSemver) riskNotes.push('package.json version이 X.Y.Z 형식이 아닙니다.')
  if (exists) riskNotes.push('이미 같은 버전의 Git 태그가 존재합니다.')
  if (status.out.trim().length > 0) riskNotes.push('작업 폴더에 미커밋 변경이 있습니다. 태그는 현재 커밋(HEAD)을 가리킵니다.')

  const preserved = current && current.tagName === tagName ? current : null
  current = {
    id: `snap-${tagName}`,
    version,
    tagName,
    title: meta?.title ?? preserved?.title ?? `SJ OS ${tagName}`,
    releaseNote: meta?.releaseNote ?? preserved?.releaseNote ?? `${tagName} 스태프 릴리즈 스냅샷`,
    commitHash,
    packageJsonVersion: version,
    linkedStaffVersionId: meta?.linkedStaffVersionId ?? preserved?.linkedStaffVersionId,
    linkedReleaseApprovalItemId: meta?.linkedReleaseApprovalItemId ?? preserved?.linkedReleaseApprovalItemId,
    verification: meta?.verification ?? preserved?.verification,
    manualTestChecklist: meta?.manualTestChecklist ?? preserved?.manualTestChecklist ?? [],
    status: !validSemver || exists ? 'blocked' : 'tag-ready',
    tagExists: exists,
    pushed: preserved?.pushed ?? false,
    validSemver,
    riskNotes,
    logLines: preserved?.logLines ?? [],
    createdAt: preserved?.createdAt ?? nowIso(),
    approvedAt: preserved?.approvedAt,
    taggedAt: preserved?.taggedAt,
    pushedAt: preserved?.pushedAt,
    errorMessage: exists ? '이미 같은 버전의 Git 태그가 존재합니다.' : !validSemver ? '유효한 버전(X.Y.Z)이 아닙니다.' : undefined
  }
  return current
}

function guardCurrent(snapshotId: string): ReleaseSnapshot | { error: string } {
  if (!current || current.id !== snapshotId) return { error: '스냅샷을 먼저 준비 확인하세요.' }
  if (!sameWorkspace(mainWorkspace(), ALLOWED_WORKSPACE_MAIN)) return { error: '허용된 작업 폴더가 아닙니다.' }
  return current
}

/** Create the approved annotated tag (git tag -a vX.Y.Z -m "..."). */
export async function createApprovedTag(snapshotId: string): Promise<ReleaseSnapshot> {
  const g = guardCurrent(snapshotId)
  if ('error' in g) return { ...(current ?? (await inspectTagReadiness())), status: 'blocked', errorMessage: g.error }
  const tag = g.tagName
  if (!isValidTagName(tag) || !g.validSemver) {
    current = { ...g, status: 'blocked', errorMessage: '태그 이름 형식(vX.Y.Z)이 올바르지 않습니다.' }
    return current
  }
  if (!g.commitHash) {
    current = { ...g, status: 'blocked', errorMessage: '현재 커밋(HEAD)을 확인할 수 없습니다.' }
    return current
  }
  if (await tagExistsLocally(tag)) {
    current = { ...g, tagExists: true, status: 'blocked', errorMessage: '이미 같은 버전의 Git 태그가 존재합니다.' }
    return current
  }
  const message = `SJ OS ${tag} - Staff release snapshot`
  const res = await runFixed('git', ['tag', '-a', tag, '-m', message])
  if (res.code !== 0) {
    current = { ...g, status: 'failed', logLines: [...g.logLines, res.out.trim().slice(-500)], errorMessage: 'git tag 생성 실패' }
    return current
  }
  current = {
    ...g,
    status: 'tag-push-ready',
    tagExists: true,
    taggedAt: nowIso(),
    logLines: [...g.logLines, `git tag -a ${tag} -m "${message}" · 생성됨`]
  }
  return current
}

/** Push the created tag (git push origin vX.Y.Z; NEVER --tags / --force). */
export async function pushApprovedTag(snapshotId: string): Promise<ReleaseSnapshot> {
  const g = guardCurrent(snapshotId)
  if ('error' in g) return { ...(current ?? (await inspectTagReadiness())), status: 'blocked', errorMessage: g.error }
  const tag = g.tagName
  if (!isValidTagName(tag)) {
    current = { ...g, status: 'blocked', errorMessage: '태그 이름 형식(vX.Y.Z)이 올바르지 않습니다.' }
    return current
  }
  if (!(await tagExistsLocally(tag))) {
    current = { ...g, status: 'blocked', errorMessage: '로컬에 태그가 없습니다. 먼저 태그를 생성하세요.' }
    return current
  }
  // Fixed: push only this tag ref to origin. No --tags, no --force.
  const res = await runFixed('git', ['push', 'origin', tag])
  const log = res.out.trim().split(/\r?\n/).slice(-8).join('\n')
  if (res.code !== 0) {
    current = { ...g, status: 'failed', logLines: [...g.logLines, log], errorMessage: 'git push 실패 (로그 확인)' }
    return current
  }
  current = { ...g, status: 'tag-pushed', pushed: true, pushedAt: nowIso(), logLines: [...g.logLines, `git push origin ${tag} · 완료`, log].filter(Boolean) }
  return current
}
