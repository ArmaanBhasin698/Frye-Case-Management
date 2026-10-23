"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createWorkflowTemplate, saveWorkflowTemplateVersion, type FormState } from "@/lib/workflows/actions";
import {
  OFFSET_DISCLAIMER,
  WORKFLOW_ASSIGNEE_RULE_LABELS,
  WORKFLOW_ASSIGNEE_RULE_VALUES,
  WORKFLOW_CATEGORY_LABELS,
  WORKFLOW_CATEGORY_VALUES,
} from "@/lib/workflows/labels";
import { calendarEventTypeLabel } from "@/lib/matters/format";

const INITIAL: FormState = { error: null };
const EVENT_TYPES = [
  "CLIENT_MEETING",
  "INTERNAL_MEETING",
  "HEARING",
  "TRIAL",
  "DEPOSITION",
  "CONSULTATION",
  "VIRTUAL_MEETING",
  "PHONE_CALL",
  "MEETING",
  "OTHER",
] as const;

export type EditorStep = {
  kind: "TASK" | "EVENT";
  title: string;
  description: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  offsetDays: number;
  timeOfDay: string;
  durationMinutes: number | "";
  eventType: string;
  assigneeRule: (typeof WORKFLOW_ASSIGNEE_RULE_VALUES)[number];
  assigneeUserId: string;
};

const blankStep = (): EditorStep => ({
  kind: "TASK",
  title: "",
  description: "",
  priority: "NORMAL",
  offsetDays: 0,
  timeOfDay: "",
  durationMinutes: "",
  eventType: "OTHER",
  assigneeRule: "UNASSIGNED",
  assigneeUserId: "",
});

/**
 * Create a template or save a new version of one. Steps are a controlled,
 * ordered list serialized into a hidden `steps` field; array order is the
 * step order. The server re-validates everything (lib/workflows/fields.ts).
 */
export function WorkflowTemplateEditor({
  templateId,
  initial,
  staff,
}: {
  templateId?: string;
  initial?: { name: string; description: string; category: string; steps: EditorStep[] };
  staff: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(templateId ? saveWorkflowTemplateVersion : createWorkflowTemplate, INITIAL);
  const [steps, setSteps] = React.useState<(EditorStep & { key: string })[]>(() =>
    (initial?.steps.length ? initial.steps : [blankStep()]).map((s, i) => ({ ...s, key: `initial-${i}` })),
  );
  const nextKey = React.useRef(0);
  const [, startTransition] = React.useTransition();
  const [saved, setSaved] = React.useState(false);

  function update(key: string, patch: Partial<EditorStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function move(index: number, delta: number) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  // onSubmit (not <form action>) so a validation error doesn't reset the editor.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set(
      "steps",
      JSON.stringify(
        steps.map((s) => ({
          kind: s.kind,
          title: s.title,
          priority: s.priority,
          offsetDays: s.offsetDays,
          eventType: s.eventType,
          assigneeRule: s.assigneeRule,
          description: s.description || null,
          timeOfDay: s.timeOfDay || null,
          durationMinutes: s.durationMinutes === "" ? null : s.durationMinutes,
          assigneeUserId: s.assigneeUserId || null,
        })),
      ),
    );
    setSaved(false);
    startTransition(() => formAction(formData));
  }

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setSaved(!state.error);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-border bg-card p-6">
      {templateId && <input type="hidden" name="templateId" value={templateId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wf-name">Template name</Label>
          <Input id="wf-name" name="name" required defaultValue={initial?.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wf-category">Applies to</Label>
          <Select id="wf-category" name="category" defaultValue={initial?.category ?? "OTHER"}>
            {WORKFLOW_CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>
                {WORKFLOW_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="wf-description">Description</Label>
          <Textarea id="wf-description" name="description" rows={2} defaultValue={initial?.description} />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Steps (in order)</h2>
          <p className="text-xs text-muted-foreground">{OFFSET_DISCLAIMER}</p>
        </div>
        {steps.map((step, index) => (
          <fieldset key={step.key} className="space-y-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="text-sm font-medium">Step {index + 1}</legend>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move step up">
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => move(index, 1)}
                  disabled={index === steps.length - 1}
                  aria-label="Move step down"
                >
                  ↓
                </Button>
                {steps.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSteps(steps.filter((s) => s.key !== step.key))}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Kind</Label>
                <Select aria-label="Kind" value={step.kind} onChange={(e) => update(step.key, { kind: e.target.value as EditorStep["kind"] })}>
                  <option value="TASK">Task</option>
                  <option value="EVENT">Calendar event</option>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label className="text-xs">Title</Label>
                <Input aria-label="Step title" value={step.title} onChange={(e) => update(step.key, { title: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Offset (calendar days)</Label>
                <Input
                  aria-label="Offset days"
                  type="number"
                  value={step.offsetDays}
                  onChange={(e) => update(step.key, { offsetDays: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select aria-label="Priority" value={step.priority} onChange={(e) => update(step.key, { priority: e.target.value as EditorStep["priority"] })}>
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Assign to</Label>
                <Select
                  aria-label="Assignee rule"
                  value={step.assigneeRule}
                  onChange={(e) => update(step.key, { assigneeRule: e.target.value as EditorStep["assigneeRule"] })}
                >
                  {WORKFLOW_ASSIGNEE_RULE_VALUES.map((r) => (
                    <option key={r} value={r}>
                      {WORKFLOW_ASSIGNEE_RULE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </div>
              {step.assigneeRule === "SPECIFIC_USER" && (
                <div className="space-y-1">
                  <Label className="text-xs">Staff member</Label>
                  <Select aria-label="Staff member" value={step.assigneeUserId} onChange={(e) => update(step.key, { assigneeUserId: e.target.value })}>
                    <option value="">Choose…</option>
                    {staff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {step.kind === "EVENT" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Time of day (blank = all day)</Label>
                    <Input aria-label="Time of day" type="time" value={step.timeOfDay} onChange={(e) => update(step.key, { timeOfDay: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Duration (minutes)</Label>
                    <Input
                      aria-label="Duration minutes"
                      type="number"
                      min={5}
                      value={step.durationMinutes}
                      onChange={(e) => update(step.key, { durationMinutes: e.target.value === "" ? "" : Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Event type</Label>
                    <Select aria-label="Event type" value={step.eventType} onChange={(e) => update(step.key, { eventType: e.target.value })}>
                      {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {calendarEventTypeLabel(t)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
              <div className="space-y-1 sm:col-span-4">
                <Label className="text-xs">Description (optional)</Label>
                <Textarea aria-label="Step description" rows={2} value={step.description} onChange={(e) => update(step.key, { description: e.target.value })} />
              </div>
            </div>
          </fieldset>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setSteps([...steps, { ...blankStep(), key: `added-${nextKey.current++}` }])}>
          Add step
        </Button>
      </div>

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      {templateId && saved && !isPending && !state.error && <p className="text-sm text-muted-foreground">Saved as a new version.</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/admin/workflows">Back</Link>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : templateId ? "Save as new version" : "Create template"}
        </Button>
      </div>
    </form>
  );
}
