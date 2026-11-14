/**
 * `cortex schedule` core — moved to @nexus-cortex/core (config/schedule.ts, 2026-11-14) so the TUIs' in-session scheduler and the OS
 * ticker share one implementation (library-first). Re-exported here for the CLI command and its tests.
 */
export {
  schedulesFile, scheduleOwnerFile, loadJobs, saveJobs, upsertJob, removeJob, dueJobs, stampJob, jobInvocation, mailGate, hasUnreadMail,
  peekMailAsync, acquireTickLock, readScheduleOwner, liveScheduleOwner, claimScheduleOwner, releaseScheduleOwner, OWNER_STALE_MS,
  InSessionScheduler, scheduledTurnPrompt, type ScheduleJob, type ScheduleOwner,
} from '@nexus-cortex/core';
