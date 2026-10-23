"use client";

import * as React from "react";
import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { applyWorkflow, previewWorkflow, type ApplyState } from "@/lib/workflows/actions";
import { formatInZone } from "@/lib/calendar/timezone";
import { OFFSET_DISCLAIMER } from "@/lib/workflows/labels";
import type { PreviewItem } from "@/lib/workflows/schedule";

const INITIAL: ApplyState = { error: null };

function describeWhen(item: PreviewItem, timeZone: string) {
  const s = item.schedule;
  if (s.kind === "TASK") return `Due ${s.dateKey}`;
  if (s.allDay) return `${s.dateKey} (all day)`;
  return formatInZone(s.startTime, timeZone, { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" });
}

/**
 * Pick a template, anchor date and time zone → preview every generated
 * task/event with its computed date and resolved assignee → confirm.
 * `requestKey` comes from the server render, so resubmitting this form is
 * idempotent while a freshly rendered form is a deliberate new application.
 */
export function ApplyWorkflowPanel({
  matterId,
  requestKey,
  templates,
  timeZones,
  defaultAnchor,
}: {
  matterId: string;
  requestKey: string;
  templates: { versionId: string; label: string }[];
  timeZones: readonly string[];
  defaultAnchor: string;
}) {
  const [state, formAction, isPending] = useActionState(applyWorkflow, INITIAL);
  const [templateVersionId, setTemplateVersionId] = React.useState(templates[0]?.versionId ?? "");
  const [anchorDate, setAnchorDate] = React.useState(defaultAnchor);
  const [timeZone, setTimeZone] = React.useState(timeZones[0] ?? "America/New_York");
  const [preview, setPreview] = React.useState<{ items: PreviewItem[]; title: string } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function runPreview() {
    setLoading(true);
    setPreviewError(null);
    const result = await previewWorkflow({ matterId, templateVersionId, anchorDate, timeZone });
    setLoading(false);
    if (result.ok) setPreview({ items: result.data.items, title: `${result.data.templateName} (v${result.data.version})` });
    else {
      setPreview(null);
      setPreviewError(result.error);
    }
  }

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No active workflow templates yet. An admin can create or install them under Admin → Workflows.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="wf-template" className="text-xs">
            Template
          </Label>
          <Select
            id="wf-template"
            className="w-72"
            value={templateVersionId}
            onChange={(e) => {
              setTemplateVersionId(e.target.value);
              setPreview(null);
            }}
          >
            {templates.map((t) => (
              <option key={t.versionId} value={t.versionId}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="wf-anchor" className="text-xs">
            Anchor date
          </Label>
          <Input
            id="wf-anchor"
            type="date"
            className="w-44"
            value={anchorDate}
            onChange={(e) => {
              setAnchorDate(e.target.value);
              setPreview(null);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wf-tz" className="text-xs">
            Time zone
          </Label>
          <Select
            id="wf-tz"
            className="w-52"
            value={timeZone}
            onChange={(e) => {
              setTimeZone(e.target.value);
              setPreview(null);
            }}
          >
            {timeZones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={runPreview} disabled={loading || !anchorDate}>
          {loading ? "Previewing…" : "Preview"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{OFFSET_DISCLAIMER}</p>
      {previewError && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {previewError}
        </p>
      )}

      {preview && (
        <form action={formAction} className="space-y-3 rounded-md border border-border p-3">
          <input type="hidden" name="matterId" value={matterId} />
          <input type="hidden" name="templateVersionId" value={templateVersionId} />
          <input type="hidden" name="anchorDate" value={anchorDate} />
          <input type="hidden" name="timeZone" value={timeZone} />
          <input type="hidden" name="requestKey" value={requestKey} />
          <p className="text-sm font-medium">Preview: {preview.title}</p>
          <ul className="divide-y divide-border text-sm">
            {preview.items.map((item) => (
              <li key={item.stepId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Badge variant="outline">{item.kind === "TASK" ? "Task" : "Event"}</Badge> <span className="font-medium">{item.title}</span>
                  <p className="text-xs text-muted-foreground">{describeWhen(item, timeZone)}</p>
                </div>
                <div className="text-right text-xs">
                  <p>{item.assignee.name ?? "Unassigned"}</p>
                  {item.assignee.note && <p className="text-amber-700">{item.assignee.note}</p>}
                </div>
              </li>
            ))}
          </ul>
          {state.error && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {state.error}
            </p>
          )}
          {state.applicationId && !state.error && (
            <p className="text-sm text-muted-foreground">
              {state.duplicate ? "Already applied — this submission was not duplicated." : "Workflow applied."}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending || Boolean(state.applicationId)}>
              {isPending ? "Applying…" : `Confirm and create ${preview.items.length} item${preview.items.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
