/**
 * One-time demo/practice data purge.
 *
 * The app seeds sample business records (customers, consultations, schedules,
 * performance, notices, …) into localStorage so screens aren't empty during
 * development. Before a real employee starts using SJ OS we clear that accumulated
 * practice data exactly once, so they begin from a clean slate.
 *
 * PRESERVED (never purged): the login session, phone-login accounts, and team
 * structure — these are real account/org setup, not practice data. Runs once, guarded
 * by a version flag; any data the employee enters afterwards is kept.
 */

const RESET_FLAG = 'sj-os:demo-reset:v1'

/** Keys that hold real account/org/app state — must survive the purge. */
const PRESERVE = new Set<string>([
  'sj-os:session:v1', // current login
  'sj-os:app-mode:v1', // local vs supabase mode
  'sj.phoneLogin.accounts', // staff login accounts
  'sj.phoneLogin.resets',
  'sj.teams', // team/org structure
  RESET_FLAG
])

/** Non-`sj-os:` demo/business-data keys to clear. */
const DEMO_KEYS = [
  'sj.announcements',
  'sj.announcement.reads',
  'sj.dashboard.records',
  'sj.release.approvalItems',
  'sj.install.guides',
  'sj.dist.packages',
  'sj.claude.completionReports',
  'sj.deploy.profileDraft'
]

export function resetDemoDataOnce(): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(RESET_FLAG)) return

    // Every `sj-os:<domain>:v1` data key except the preserved infra/auth ones.
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith('sj-os:') && !PRESERVE.has(key)) toRemove.push(key)
    }
    for (const key of DEMO_KEYS) {
      if (!PRESERVE.has(key)) toRemove.push(key)
    }
    for (const key of toRemove) localStorage.removeItem(key)

    localStorage.setItem(RESET_FLAG, '1')
  } catch {
    /* best effort — never block app startup */
  }
}
