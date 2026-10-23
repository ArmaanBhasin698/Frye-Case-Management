"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { installStarterWorkflowTemplates, setWorkflowTemplateStatus } from "@/lib/workflows/actions";

export function TemplateStatusButton({ templateId, archived }: { templateId: string; archived: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function toggle() {
    setPending(true);
    setError(null);
    const result = await setWorkflowTemplateStatus({ templateId, status: archived ? "ACTIVE" : "ARCHIVED" });
    setPending(false);
    if (!result.ok) setError(result.error);
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {archived ? "Reactivate" : "Archive"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** Idempotent: creates only starter templates whose names don't exist yet. */
export function InstallStartersButton() {
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  async function install() {
    setPending(true);
    const result = await installStarterWorkflowTemplates();
    setPending(false);
    setMessage(
      result.ok
        ? result.data.created.length
          ? `Installed: ${result.data.created.join(", ")}`
          : "All starter templates are already installed."
        : result.error,
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={install}>
        Install starter templates
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </span>
  );
}
