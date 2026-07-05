/**
 * Shared contract for the staff distribution package registry.
 *
 * Tracks desktop installer packages for staff releases: which file belongs to
 * which version, its size + SHA-256, and local staff-distribution records. It only
 * INSPECTS fixed output folders inside the workspace and computes checksums — it
 * never uploads, publishes, sends files, or builds installers. The renderer never
 * runs shell commands and never passes a file path.
 */

export type InstallerFileType = 'exe' | 'msi' | 'zip' | 'dmg' | 'appimage' | 'unknown'

/** Folders inside the workspace that may hold installer output (inspected only). */
export const DIST_INSPECT_DIRS = ['release', 'dist', 'out', 'build', 'dist-electron']

/** Allowed installer file extensions (lowercase). */
export const ALLOWED_INSTALLER_EXT = ['.exe', '.msi', '.zip', '.dmg', '.appimage']

export function installerFileType(fileName: string): InstallerFileType {
  const n = (fileName ?? '').toLowerCase()
  if (n.endsWith('.exe')) return 'exe'
  if (n.endsWith('.msi')) return 'msi'
  if (n.endsWith('.zip')) return 'zip'
  if (n.endsWith('.dmg')) return 'dmg'
  if (n.endsWith('.appimage')) return 'appimage'
  return 'unknown'
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** A detected installer candidate (from a safe output folder). */
export interface DetectedPackageFile {
  id: string
  fileName: string
  relativePath: string
  sizeBytes: number
  sizeLabel: string
  modifiedAt: string
  fileType: InstallerFileType
}

/** Main → renderer inspection result. */
export interface PackageOutputInspection {
  version: string
  inspectedDirs: string[]
  files: DetectedPackageFile[]
  errorMessage?: string
}

/** Registered package info returned by main after checksum. */
export interface RegisteredPackageInfo {
  version: string
  fileName: string
  relativePath: string
  sizeBytes: number
  sizeLabel: string
  sha256: string
  fileType: InstallerFileType
  errorMessage?: string
}

export type DistributionStatus =
  | 'draft'
  | 'detected'
  | 'registered'
  | 'ready-for-distribution'
  | 'distributed'
  | 'archived'
  | 'blocked'
  | 'failed'

export type DistributionMethod =
  | 'manual-copy'
  | 'shared-drive'
  | 'download-link-planned'
  | 'auto-update-planned'
  | 'unknown'

export type StaffRecordStatus = 'not-sent' | 'sent' | 'installed' | 'failed' | 'skipped'

export interface StaffDistributionRecord {
  id: string
  staffName: string
  staffRole?: string
  version: string
  status: StaffRecordStatus
  sentAt?: string
  installedAt?: string
  notes?: string
}

/** A registered staff distribution package (stored locally in the renderer). */
export interface StaffDistributionPackage {
  id: string
  version: string
  title: string
  packageFileName: string
  packageRelativePath: string
  packageSizeBytes: number
  packageSizeLabel: string
  sha256: string
  fileType: InstallerFileType
  linkedReleaseSnapshotId?: string
  linkedStaffVersionId?: string
  linkedReleaseApprovalItemId?: string
  commitHash?: string
  tagName?: string
  releaseNote: string
  status: DistributionStatus
  distributionMethod: DistributionMethod
  staffTargets: string[]
  distributionRecords: StaffDistributionRecord[]
  riskNotes: string[]
  createdAt: string
  registeredAt?: string
  updatedAt: string
  errorMessage?: string
}
