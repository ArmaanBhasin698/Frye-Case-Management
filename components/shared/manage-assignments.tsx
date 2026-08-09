"use client";

import * as React from "react";
import type { AssignmentRole } from "@prisma/client";

import { assignmentRoleLabel } from "@/lib/matters/format";
import { addMatterAssignment, removeMatterAssignment } from "@/lib/matters/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

type Assignment = { id: string; role: AssignmentRole; user: { id: string; name: string } };
type StaffOption = { id: string; name: string; role: string };

const ASSIGNMENT_ROLE_OPTIONS: AssignmentRole[] = [
  "LEAD_ATTORNEY",
  "ASSOCIATE_ATTORNEY",
  "PARALEGAL",
  "STAFF",
];

/**
 * Add/remove staff assignments on an existing matter — a sibling to
 * lib/matters/actions.ts#createMatter's initial-assignment step, for the
 * "MatterAssignment changes performed through these workflows" requirement
 * (see docs/SECURITY.md's audit logging section). Calls the Server Actions
 * directly (not a <form>), same pattern as attach-call-list.tsx.
 */
export function ManageAssignments({
  matterId,
  assignments,
  staff,
}: {
  matterId: string;
  assignments: Assignment[];
  staff: StaffOption[];
}) {
  const [rows, setRows] = React.useState(assignments);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [newUserId, setNewUserId] = React.useState("");
  const [newRole, setNewRole] = React.useState<AssignmentRole>("ASSOCIATE_ATTORNEY");
  const [adding, setAdding] = React.useState(false);

  const assignedUserIds = new Set(rows.map((r) => r.user.id));
  const availableStaff = staff.filter((s) => !assignedUserIds.has(s.id));

  async function handleAdd() {
    if (!newUserId) return;
    setError(null);
    setAdding(true);
    const result = await addMatterAssignment({ matterId, userId: newUserId, role: newRole });
    setAdding(false);
    if (result.ok) {
      const person = staff.find((s) => s.id === newUserId);
      if (person) {
        setRows((prev) => [...prev, { id: `${person.id}-pending`, role: newRole, user: { id: person.id, name: person.name } }]);
      }
      setNewUserId("");
    } else {
      setError(result.error);
    }
  }

  async function handleRemove(assignmentId: string) {
    setError(null);
    setPendingId(assignmentId);
    const result = await removeMatterAssignment({ matterId, assignmentId });
    setPendingId(null);
    if (result.ok) {
      setRows((prev) => prev.filter((r) => r.id !== assignmentId));
    } else {
      setError(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff assignments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff assigned.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium text-foreground">{assignment.user.name}</span>{" "}
                  <span className="text-muted-foreground">({assignmentRoleLabel(assignment.role)})</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pendingId === assignment.id || rows.length === 1}
                  onClick={() => handleRemove(assignment.id)}
                  title={rows.length === 1 ? "A matter must keep at least one assigned staff member" : undefined}
                >
                  {pendingId === assignment.id ? "Removing…" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}

        {availableStaff.length > 0 && (
          <div className="flex items-end gap-2 border-t border-border pt-3">
            <Select
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              className="flex-1"
              aria-label="Staff member to add"
            >
              <option value="">Add staff member…</option>
              {availableStaff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
            <Select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as AssignmentRole)}
              aria-label="Assignment role"
            >
              {ASSIGNMENT_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {assignmentRoleLabel(role)}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" disabled={!newUserId || adding} onClick={handleAdd}>
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
