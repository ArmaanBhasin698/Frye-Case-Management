import { prisma } from "@/lib/db";
import {
  fetchContactsPage,
  HighLevelApiError,
  HighLevelMalformedResponseError,
} from "@/lib/intake/highlevelClient";
import { ingestHighLevelContactEvent } from "@/lib/intake/ingest";
import { normalizeIntakeLead } from "@/lib/intake/normalize";

/**
 * Pull-based HighLevel contact sync — the one reusable service behind both
 * the scheduled cron entry point (app/api/cron/highlevel-sync) and the
 * manual "Sync from Loop" action (lib/intake/reviewActions.ts). Neither
 * caller implements its own ingestion: both call `runHighLevelContactSync`
 * below, which walks `GET /contacts/` (see lib/intake/highlevelClient.ts)
 * and feeds every contact through the exact same `normalizeIntakeLead` /
 * `ingestHighLevelContactEvent` the webhook path already uses — see
 * lib/intake/README.md for why there is deliberately only one intake
 * pipeline, not a second one for polling.
 *
 * Incremental strategy (see docs/INTEGRATION_ARCHITECTURE.md for the live
 * verification behind this): HighLevel's contacts list is confirmed sorted
 * newest-`dateAdded`-first with no server-side date filter this codebase
 * verified or is willing to guess at, so incrementality is entirely
 * client-side — walk pages from the top, stop once a page's contacts fall
 * at or before the persisted checkpoint (minus a small overlap window),
 * and rely on `ingestHighLevelContactEvent`'s own idempotency to make
 * re-examining the overlap window a safe no-op. This only reliably detects
 * *new* contacts; a bare edit to an already-`PENDING` lead's fields, with
 * no new `dateAdded`, is not something this endpoint can safely surface
 * without processing the whole roster every run — a known, accepted gap
 * (the retained-but-inactive webhook path is the only thing that ever
 * covered that case).
 *
 * Checkpoint safety: the persisted checkpoint only ever advances to the
 * `dateAdded` of the last contact this run actually finished processing,
 * in an unbroken top-down walk starting fresh at page 1 every time (the
 * HighLevel pagination cursor from one run has no defined meaning in the
 * next, since contacts created in between shift what "page 1" contains).
 * A failure partway through — rate limit, auth, malformed response, a
 * database error — simply stops the walk there; the next run (manual or
 * scheduled) picks back up from that exact point.
 *
 * Concurrency: `HighLevelSyncState.runningSince` is claimed with an atomic
 * conditional update, the same pattern this codebase already uses for
 * `MfaChallengeTicket`'s single-use consumption — a manual click and a
 * scheduled tick can never process the same window twice at once; a
 * second concurrent caller just gets `{outcome: "already_running"}`.
 */

/** The one singleton row's fixed id — exported so lib/intake/queries.ts#getHighLevelSyncState reads the same constant instead of a second hardcoded literal. */
export const SYNC_STATE_ID = "highlevel";
const PAGE_LIMIT = 100;
const OVERLAP_MS = 2 * 60 * 1000;
const STALE_LOCK_MS = 10 * 60 * 1000;

export type SyncTrigger = "manual" | "scheduled";

export type SyncSummary = {
  contactsChecked: number;
  newLeadsCreated: number;
  pendingLeadsUpdated: number;
  linkedOrSkipped: number;
  failureCount: number;
  lastRunOutcome: "success" | "partial_failure";
};

export type SyncRunResult = { outcome: "already_running" } | ({ outcome: "completed" } & SyncSummary);

/** Enough to distinguish failure categories in logs/audit metadata — never a raw HighLevel error body. */
function categorizeSyncFailure(error: unknown): string {
  if (error instanceof HighLevelMalformedResponseError) return "malformed_response";
  if (error instanceof HighLevelApiError) {
    if (error.status === 401) return "auth_failed";
    if (error.status === 403) return "missing_scopes";
    if (error.status === 429) return "rate_limited";
    return "api_error";
  }
  return "unexpected_error";
}

/** Raw HighLevel contact fields -> undefined for anything missing/null, mapped onto normalizeIntakeLead's shared shape. No `type` (a REST contact has none — see lib/intake/normalize.ts). */
function adaptHighLevelContact(raw: unknown): unknown {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof c.id === "string" ? c.id : undefined,
    firstName: typeof c.firstName === "string" ? c.firstName : undefined,
    lastName: typeof c.lastName === "string" ? c.lastName : undefined,
    contactName: typeof c.contactName === "string" ? c.contactName : undefined,
    email: typeof c.email === "string" ? c.email : undefined,
    phone: typeof c.phone === "string" ? c.phone : undefined,
    dateAdded: typeof c.dateAdded === "string" ? c.dateAdded : undefined,
  };
}

function extractDateAdded(raw: unknown): Date | null {
  const c = (raw ?? {}) as Record<string, unknown>;
  if (typeof c.dateAdded !== "string") return null;
  const date = new Date(c.dateAdded);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function claimLock(now: Date): Promise<boolean> {
  await prisma.highLevelSyncState.upsert({ where: { id: SYNC_STATE_ID }, update: {}, create: { id: SYNC_STATE_ID } });
  const claimed = await prisma.highLevelSyncState.updateMany({
    where: {
      id: SYNC_STATE_ID,
      OR: [{ runningSince: null }, { runningSince: { lt: new Date(now.getTime() - STALE_LOCK_MS) } }],
    },
    data: { runningSince: now, lastAttemptedSyncAt: now },
  });
  return claimed.count === 1;
}

export async function runHighLevelContactSync(trigger: SyncTrigger, actorId: string | null): Promise<SyncRunResult> {
  const now = new Date();
  if (!(await claimLock(now))) {
    return { outcome: "already_running" };
  }

  let contactsChecked = 0;
  let newLeadsCreated = 0;
  let pendingLeadsUpdated = 0;
  let linkedOrSkipped = 0;
  let failureCount = 0;
  let failureCategory: string | null = null;
  let lastProcessedDateAdded: Date | null = null;

  try {
    const state = await prisma.highLevelSyncState.findUnique({ where: { id: SYNC_STATE_ID } });
    const checkpoint = state?.lastSuccessfulCheckpoint ?? null;
    const threshold = checkpoint ? new Date(checkpoint.getTime() - OVERLAP_MS) : null;

    let after: { startAfter: number; startAfterId: string } | undefined;
    let stop = false;

    while (!stop) {
      let page;
      try {
        page = await fetchContactsPage(PAGE_LIMIT, after);
      } catch (error) {
        failureCount += 1;
        failureCategory = categorizeSyncFailure(error);
        break;
      }

      for (const raw of page.contacts) {
        const dateAdded = extractDateAdded(raw);
        if (!dateAdded) {
          contactsChecked += 1;
          linkedOrSkipped += 1;
          continue;
        }
        if (threshold && dateAdded.getTime() <= threshold.getTime()) {
          stop = true;
          break;
        }

        contactsChecked += 1;
        const adapted = adaptHighLevelContact(raw);
        const normalized = normalizeIntakeLead(adapted);
        if (!normalized.ok) {
          // Do NOT advance the checkpoint past a contact we couldn't
          // parse. dateAdded never changes even if the contact is fixed
          // in HighLevel later — silently skipping-and-advancing would
          // make it permanently unreachable by every future run. Stop
          // here instead, same as any other failure category; the next
          // run (manual or scheduled) retries from this exact point.
          failureCount += 1;
          failureCategory = "malformed_contact";
          stop = true;
          break;
        }

        let result;
        try {
          result = await ingestHighLevelContactEvent(adapted);
        } catch {
          failureCount += 1;
          failureCategory = "database_error";
          stop = true;
          break;
        }

        if (result.outcome === "recorded" && result.created) newLeadsCreated += 1;
        else if (result.outcome === "recorded" && !result.created) pendingLeadsUpdated += 1;
        else linkedOrSkipped += 1;

        lastProcessedDateAdded = dateAdded;
      }

      if (stop) break;
      if (page.meta.nextPage == null || page.meta.startAfter === undefined || page.meta.startAfterId === undefined) {
        break;
      }
      after = { startAfter: page.meta.startAfter, startAfterId: page.meta.startAfterId };
    }

    const newCheckpoint = lastProcessedDateAdded ?? checkpoint;
    const lastRunOutcome: "success" | "partial_failure" = failureCount > 0 ? "partial_failure" : "success";

    await prisma.highLevelSyncState.update({
      where: { id: SYNC_STATE_ID },
      data: {
        runningSince: null,
        lastSuccessfulCheckpoint: newCheckpoint,
        lastSuccessfulSyncAt: lastRunOutcome === "success" ? now : (state?.lastSuccessfulSyncAt ?? null),
        contactsChecked,
        newLeadsCreated,
        pendingLeadsUpdated,
        linkedOrSkipped,
        failureCount,
        lastRunOutcome,
      },
    });

    // One audit event per completed run — never per-contact (see module
    // comment). `actorId` carries who initiated a manual run; null for
    // scheduled. Never a contact name/email/phone — counts only.
    await prisma.auditEvent.create({
      data: {
        actorId,
        action: "UPDATE",
        entityType: "HighLevelSyncState",
        entityId: SYNC_STATE_ID,
        metadata: {
          trigger,
          outcome: lastRunOutcome,
          contactsChecked,
          newLeadsCreated,
          pendingLeadsUpdated,
          linkedOrSkipped,
          failureCount,
          ...(failureCategory ? { failureCategory } : {}),
        },
      },
    });

    console.log(
      `[highlevelSync] ${trigger} run ${lastRunOutcome}: checked=${contactsChecked} new=${newLeadsCreated} updated=${pendingLeadsUpdated} skipped=${linkedOrSkipped} failures=${failureCount}${failureCategory ? ` (${failureCategory})` : ""}`,
    );

    return { outcome: "completed", contactsChecked, newLeadsCreated, pendingLeadsUpdated, linkedOrSkipped, failureCount, lastRunOutcome };
  } catch (error) {
    await prisma.highLevelSyncState
      .update({ where: { id: SYNC_STATE_ID }, data: { runningSince: null, lastRunOutcome: "failed" } })
      .catch(() => {});
    console.error("[highlevelSync] unexpected failure, lock released", error instanceof Error ? error.message : "unknown error");
    throw error;
  }
}
