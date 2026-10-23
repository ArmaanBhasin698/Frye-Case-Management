import { prisma } from "@/lib/db";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import type { MatterTeam, StepInput } from "@/lib/workflows/schedule";

/**
 * Workflow reads. Template management pages are ADMIN-only (checked by the
 * pages); matter-scoped reads assume the caller already asserted matter
 * access.
 */

/**
 * Who may apply a workflow to a matter: ADMIN, or an ATTORNEY/PARALEGAL
 * assigned to that matter. STAFF and unassigned users may not — applying
 * creates tasks and events for other people.
 */
export async function canApplyWorkflow(user: AuthorizableUser, matterId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (user.role !== "ATTORNEY" && user.role !== "PARALEGAL") return false;
  const assignment = await prisma.matterAssignment.count({ where: { matterId, userId: user.id } });
  return assignment > 0;
}

export async function getMatterTeam(matterId: string): Promise<MatterTeam> {
  const [assignments, admins] = await Promise.all([
    prisma.matterAssignment.findMany({
      where: { matterId },
      select: { role: true, assignedAt: true, user: { select: { id: true, name: true, status: true } } },
    }),
    prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, name: true, status: true } }),
  ]);
  return {
    assignments: assignments.map((a) => ({
      userId: a.user.id,
      name: a.user.name,
      status: a.user.status,
      role: a.role,
      assignedAt: a.assignedAt,
    })),
    admins: admins.map((a) => ({ userId: a.id, name: a.name, status: a.status })),
  };
}

const stepSelect = {
  id: true,
  position: true,
  kind: true,
  title: true,
  description: true,
  priority: true,
  offsetDays: true,
  timeOfDay: true,
  durationMinutes: true,
  eventType: true,
  assigneeRule: true,
  assigneeUserId: true,
} as const;

export function listTemplates(status: "ACTIVE" | "ARCHIVED") {
  return prisma.workflowTemplate.findMany({
    where: { status },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1, include: { _count: { select: { steps: true, applications: true } } } },
    },
    orderBy: { name: "asc" },
  });
}

export function getTemplateDetail(templateId: string) {
  return prisma.workflowTemplate.findUnique({
    where: { id: templateId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        include: {
          steps: { select: stepSelect, orderBy: { position: "asc" } },
          createdBy: { select: { name: true } },
          _count: { select: { applications: true } },
        },
      },
    },
  });
}

/** Latest version of every ACTIVE template, with ordered steps, for the apply picker. */
export async function listApplicableTemplates() {
  const templates = await prisma.workflowTemplate.findMany({
    where: { status: "ACTIVE" },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1, include: { steps: { select: stepSelect, orderBy: { position: "asc" } } } },
    },
    orderBy: { name: "asc" },
  });
  return templates
    .filter((t) => t.versions[0])
    .map((t) => ({ id: t.id, name: t.name, category: t.category, version: t.versions[0]! }));
}

export async function getVersionForApply(templateVersionId: string): Promise<{
  id: string;
  version: number;
  templateId: string;
  templateName: string;
  isLatestActive: boolean;
  steps: StepInput[];
} | null> {
  const version = await prisma.workflowTemplateVersion.findUnique({
    where: { id: templateVersionId },
    include: {
      template: { select: { id: true, name: true, status: true } },
      steps: { select: stepSelect, orderBy: { position: "asc" } },
    },
  });
  if (!version) return null;
  const latest = await prisma.workflowTemplateVersion.aggregate({
    where: { templateId: version.templateId },
    _max: { version: true },
  });
  return {
    id: version.id,
    version: version.version,
    templateId: version.template.id,
    templateName: version.template.name,
    isLatestActive: version.template.status === "ACTIVE" && latest._max.version === version.version,
    steps: version.steps,
  };
}

export function listMatterApplications(matterId: string) {
  return prisma.workflowApplication.findMany({
    where: { matterId },
    include: {
      templateVersion: { select: { version: true, template: { select: { name: true } } } },
      appliedBy: { select: { name: true } },
      tasks: {
        select: { id: true, title: true, status: true, dueDate: true, assignedTo: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
      },
      events: {
        select: { id: true, title: true, status: true, startTime: true, allDay: true, timeZone: true },
        orderBy: { startTime: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export function listActiveStaffOptions() {
  return prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
