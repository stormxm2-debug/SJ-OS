/**
 * Shared contract for the Electron installer package center.
 *
 * Builds desktop installer packages by running an EXISTING package script
 * (`dist` / `package` / `make` / `electron:build`) from Electron MAIN, after
 * explicit approval and a passing preflight. It never invents a script, installs
 * dependencies, publishes, or uploads. The renderer never runs shell commands.
 */

import type { VerificationStatus } from './claudeAutoBuild'

export type PackageScriptName = 'package' | 'dist' | 'make' | 'electron:build' | 'none'

export type PackageStatus =
  | 'not-ready'
  | 'ready'
  | 'approval-required'
  | 'approved'
  | 'preflight-running'
  | 'preflight-passed'
  | 'packaging'
  | 'packaged'
  | 'failed'
  | 'blocked'
  | 'cancelled'

export interface PackagePreflight {
  typecheckStatus: VerificationStatus
  buildStatus: VerificationStatus
  gitStatusShort: string
  packageScriptExists: boolean
  packageJsonVersion?: string
}

/** Read-only snapshot of packaging readiness from package.json + workspace. */
export interface PackageReadiness {
  appName: string
  version: string
  hasPackage: boolean
  hasDist: boolean
  hasMake: boolean
  hasElectronBuild: boolean
  detectedPackageScript: PackageScriptName
  packageScriptCommand?: string
  usesElectronBuilder: boolean
  usesElectronForge: boolean
  buildConfigPresent: boolean
  hasTypecheck: boolean
  hasBuild: boolean
}

export interface ElectronPackageRun {
  id: string
  title: string
  version: string
  status: PackageStatus
  detectedPackageScript: PackageScriptName
  packageScriptCommand?: string
  outputHints: string[]
  logLines: string[]
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  errorMessage?: string
  preflight?: PackagePreflight
}

export interface PackageRunUpdate {
  run: ElectronPackageRun
}

/** Run priority: dist → package → make → electron:build. */
export const PACKAGE_SCRIPT_PRIORITY: Exclude<PackageScriptName, 'none'>[] = [
  'dist',
  'package',
  'make',
  'electron:build'
]

/** Workspace-relative folders that may hold installer output. */
export const PACKAGE_OUTPUT_DIRS = ['dist', 'release', 'out', 'build', 'dist-electron']

// --- packaging configuration center ----------------------------------------

export type PackagingTool = 'electron-builder' | 'electron-forge' | 'none' | 'unknown'

export type PackagingConfigStatus =
  | 'not-inspected'
  | 'inspected'
  | 'ready'
  | 'missing-tool'
  | 'proposal-ready'
  | 'approval-required'
  | 'applied'
  | 'blocked'
  | 'failed'

export interface ProposedScripts {
  package?: string
  dist?: string
  make?: string
  electronBuild?: string
}

export interface ProposedMetadata {
  productName?: string
  appId?: string
  directories?: { output: string }
}

export interface ElectronPackagingConfig {
  id: string
  status: PackagingConfigStatus
  appName: string
  version: string
  detectedTool: PackagingTool
  hasPackageScript: boolean
  hasDistScript: boolean
  hasMakeScript: boolean
  hasElectronBuildScript: boolean
  proposedScripts: ProposedScripts
  proposedMetadata: ProposedMetadata
  manualSetupInstructions: string[]
  riskNotes: string[]
  updatedAt: string
  appliedAt?: string
  errorMessage?: string
}
