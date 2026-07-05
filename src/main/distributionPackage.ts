import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type {
  DetectedPackageFile,
  PackageOutputInspection,
  RegisteredPackageInfo
} from '@shared/distributionPackage'
import {
  ALLOWED_INSTALLER_EXT,
  DIST_INSPECT_DIRS,
  formatBytes,
  installerFileType
} from '@shared/distributionPackage'

/**
 * Staff distribution package registry (Electron MAIN only).
 *
 * SAFETY: inspects ONLY the fixed output folders inside the workspace, lists only
 * allowed installer file types, and computes SHA-256 for a previously-detected
 * file (never an arbitrary path from the renderer). It never uploads, publishes,
 * sends files, builds installers, or runs shell commands. Read-only + hashing.
 */

const ALLOWED_WORKSPACE_MAIN = 'C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS'
const MAX_HASH_BYTES = 4 * 1024 * 1024 * 1024 // 4 GB safety cap

function mainWorkspace(): string {
  return resolve(app.getAppPath())
}
function sameWorkspace(a: string, b: string): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}
function packageVersion(): string {
  try {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    return (JSON.parse(readFileSync(join(mainWorkspace(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Detected files from the last inspection, keyed by a stable id (relPath).
const detected = new Map<string, { relPath: string; absPath: string }>()

function idFor(relPath: string): string {
  return Buffer.from(relPath).toString('base64url').slice(0, 64)
}

/** True when abs is inside one of the safe output dirs within the workspace. */
function isInsideSafeDir(abs: string): boolean {
  const root = resolve(mainWorkspace())
  const r = resolve(abs)
  if (!r.startsWith(root)) return false
  return DIST_INSPECT_DIRS.some((d) => r.startsWith(resolve(join(root, d)) + (process.platform === 'win32' ? '\\' : '/')) || r === resolve(join(root, d)))
}

/** Inspect only the fixed output folders (top-level) for installer candidates. */
export function inspectPackageOutputs(): PackageOutputInspection {
  const version = packageVersion()
  if (!sameWorkspace(mainWorkspace(), ALLOWED_WORKSPACE_MAIN)) {
    return { version, inspectedDirs: DIST_INSPECT_DIRS, files: [], errorMessage: '허용된 작업 폴더가 아닙니다.' }
  }
  detected.clear()
  const files: DetectedPackageFile[] = []
  for (const dir of DIST_INSPECT_DIRS) {
    const abs = join(mainWorkspace(), dir)
    if (!existsSync(abs)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(abs)
    } catch {
      continue
    }
    for (const name of entries) {
      const ext = extname(name).toLowerCase()
      if (!ALLOWED_INSTALLER_EXT.includes(ext)) continue
      const fileAbs = join(abs, name)
      let st
      try {
        st = statSync(fileAbs)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      const relPath = `${dir}/${name}`
      const id = idForAndRemember(relPath, fileAbs)
      files.push({
        id,
        fileName: name,
        relativePath: relPath,
        sizeBytes: st.size,
        sizeLabel: formatBytes(st.size),
        modifiedAt: st.mtime.toISOString(),
        fileType: installerFileType(name)
      })
    }
  }
  return { version, inspectedDirs: DIST_INSPECT_DIRS, files: files.slice(0, 200) }
}

function idForAndRemember(relPath: string, absPath: string): string {
  const id = idFor(relPath)
  detected.set(id, { relPath, absPath })
  return id
}

function sha256File(abs: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const hash = createHash('sha256')
    const stream = createReadStream(abs)
    stream.on('data', (d) => hash.update(d))
    stream.on('error', rejectP)
    stream.on('end', () => resolveP(hash.digest('hex')))
  })
}

/**
 * Compute SHA-256 for a PREVIOUSLY-DETECTED package (by id). Never hashes an
 * arbitrary path from the renderer.
 */
export async function registerPackage(detectedId: string): Promise<RegisteredPackageInfo> {
  const version = packageVersion()
  const base: RegisteredPackageInfo = {
    version,
    fileName: '',
    relativePath: '',
    sizeBytes: 0,
    sizeLabel: '0 B',
    sha256: '',
    fileType: 'unknown'
  }
  const entry = detected.get(detectedId)
  if (!entry) return { ...base, errorMessage: '감지 목록에 없는 파일입니다. 다시 “설치파일 폴더 확인”을 눌러주세요.' }
  const abs = resolve(entry.absPath)
  if (!isInsideSafeDir(abs) || !existsSync(abs)) {
    return { ...base, errorMessage: '파일이 안전한 출력 폴더에 없거나 사라졌습니다.' }
  }
  const ext = extname(abs).toLowerCase()
  if (!ALLOWED_INSTALLER_EXT.includes(ext)) {
    return { ...base, errorMessage: '허용되지 않은 파일 형식입니다.' }
  }
  let st
  try {
    st = statSync(abs)
  } catch {
    return { ...base, errorMessage: '파일 정보를 읽지 못했습니다.' }
  }
  if (st.size > MAX_HASH_BYTES) {
    return { ...base, errorMessage: '파일이 너무 커서 안전하게 해시할 수 없습니다.' }
  }
  try {
    const sha256 = await sha256File(abs)
    return {
      version,
      fileName: entry.relPath.split('/').pop() ?? entry.relPath,
      relativePath: entry.relPath,
      sizeBytes: st.size,
      sizeLabel: formatBytes(st.size),
      sha256,
      fileType: installerFileType(entry.relPath)
    }
  } catch {
    return { ...base, errorMessage: 'SHA-256 계산에 실패했습니다.' }
  }
}
