import type { Blocker, CoachingNote, LeaderNextAction, TeamLeaderSnapshot } from './types'

/**
 * Team-leader cockpit seed. Starts empty — coaching notes, blockers and next
 * actions are entered by team leaders as real data.
 */

const coachingNotes: CoachingNote[] = []

const blockers: Blocker[] = []

const nextActions: LeaderNextAction[] = []

export const teamLeaderSeed: TeamLeaderSnapshot = {
  selectedTeam: null,
  coachingNotes,
  blockers,
  nextActions,
  eventLog: []
}
