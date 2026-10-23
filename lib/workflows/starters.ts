import type { PrismaClient, WorkflowCategory } from "@prisma/client";

import type { StepFields } from "@/lib/workflows/fields";

/**
 * Starter workflow templates. These definitions are only used to *create*
 * ordinary, editable WorkflowTemplate rows (via the ADMIN "Install starter
 * templates" action or prisma/seed.ts) — applying a workflow always reads
 * the database, never this file. Installing is idempotent by name: an
 * existing template with the same name (active or archived) is left alone.
 * Fictional, generic steps only; offsets are calendar days, not court rules.
 */

type Starter = { name: string; description: string; category: WorkflowCategory; steps: StepFields[] };

const task = (title: string, offsetDays: number, assigneeRule: StepFields["assigneeRule"], priority: StepFields["priority"] = "NORMAL"): StepFields => ({
  kind: "TASK",
  title,
  description: null,
  priority,
  offsetDays,
  timeOfDay: null,
  durationMinutes: null,
  eventType: null,
  assigneeRule,
  assigneeUserId: null,
});

const event = (
  title: string,
  offsetDays: number,
  timeOfDay: string | null,
  eventType: NonNullable<StepFields["eventType"]>,
  assigneeRule: StepFields["assigneeRule"],
): StepFields => ({
  kind: "EVENT",
  title,
  description: null,
  priority: "NORMAL",
  offsetDays,
  timeOfDay,
  durationMinutes: timeOfDay ? 60 : null,
  eventType,
  assigneeRule,
  assigneeUserId: null,
});

export const STARTER_TEMPLATES: Starter[] = [
  {
    name: "Retained-client setup",
    description: "First steps after a client retains the firm.",
    category: "RETAINED_CLIENT_SETUP",
    steps: [
      task("Send engagement letter and confirm retainer received", 0, "LEAD_ATTORNEY", "HIGH"),
      task("Open matter file and request charging documents", 1, "ASSIGNED_PARALEGAL"),
      event("Initial client strategy meeting", 3, "10:00", "CLIENT_MEETING", "LEAD_ATTORNEY"),
      task("Add judge, prosecutor, and officers to matter contacts", 5, "ASSIGNED_PARALEGAL"),
    ],
  },
  {
    name: "Discovery review",
    description: "Organize and review a discovery production.",
    category: "DISCOVERY_REVIEW",
    steps: [
      task("Register production files and confirm Bates ranges", 0, "ASSIGNED_PARALEGAL", "HIGH"),
      task("First-pass review of body-cam and dash-cam video", 3, "ASSIGNED_PARALEGAL"),
      task("Attorney review of police reports and witness statements", 7, "LEAD_ATTORNEY"),
      event("Discovery review conference", 10, "14:00", "INTERNAL_MEETING", "LEAD_ATTORNEY"),
    ],
  },
  {
    name: "Hearing preparation",
    description: "Prepare for a scheduled hearing (anchor = hearing date).",
    category: "HEARING_PREPARATION",
    steps: [
      task("Draft and review hearing outline", -7, "LEAD_ATTORNEY", "HIGH"),
      task("Assemble exhibits and courtesy copies", -3, "ASSIGNED_PARALEGAL"),
      event("Client prep call before hearing", -2, "16:00", "PHONE_CALL", "LEAD_ATTORNEY"),
      task("Record hearing outcome and any rulings", 1, "LEAD_ATTORNEY"),
    ],
  },
  {
    name: "Trial preparation",
    description: "Trial readiness checklist (anchor = first day of trial).",
    category: "TRIAL_PREPARATION",
    steps: [
      task("Finalize witness list and subpoenas", -30, "LEAD_ATTORNEY", "HIGH"),
      task("Prepare exhibit binders", -14, "ASSIGNED_PARALEGAL"),
      event("Mock examination session", -7, "13:00", "INTERNAL_MEETING", "LEAD_ATTORNEY"),
      event("Trial begins", 0, null, "TRIAL", "LEAD_ATTORNEY"),
    ],
  },
  {
    name: "Closure follow-up",
    description: "Wrap-up after a matter's disposition (anchor = disposition date).",
    category: "CLOSURE_FOLLOW_UP",
    steps: [
      task("Complete the structured closure report", 1, "LEAD_ATTORNEY", "HIGH"),
      task("Send closing letter to client", 3, "LEAD_ATTORNEY"),
      task("Confirm file retention and return client originals", 14, "ASSIGNED_PARALEGAL"),
    ],
  },
];

type StarterClient = Pick<PrismaClient, "workflowTemplate">;

/** Creates any missing starter templates as version 1. Returns names created. */
export async function installStarterTemplates(db: StarterClient, actorId: string | null): Promise<string[]> {
  const existing = await db.workflowTemplate.findMany({
    where: { name: { in: STARTER_TEMPLATES.map((s) => s.name) } },
    select: { name: true },
  });
  const have = new Set(existing.map((t) => t.name));
  const created: string[] = [];
  for (const starter of STARTER_TEMPLATES) {
    if (have.has(starter.name)) continue;
    await db.workflowTemplate.create({
      data: {
        name: starter.name,
        description: starter.description,
        category: starter.category,
        createdById: actorId,
        versions: {
          create: {
            version: 1,
            createdById: actorId,
            steps: { create: starter.steps.map((s, i) => ({ ...s, position: i })) },
          },
        },
      },
    });
    created.push(starter.name);
  }
  return created;
}
