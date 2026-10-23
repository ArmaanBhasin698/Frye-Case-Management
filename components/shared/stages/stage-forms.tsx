"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createStage,
  installSuggestedStages,
  moveStage,
  renameStage,
  setMatterStage,
  setStageArchived,
  type FormActionState,
} from "@/lib/stages/actions";

const INITIAL: FormActionState = { error: null };

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="text-sm font-medium text-destructive" role="alert">
      {error}
    </p>
  ) : null;
}

export function NewStageForm() {
  const [state, formAction, isPending] = useActionState(createStage, INITIAL);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Input name="name" required maxLength={60} placeholder="New stage name" className="w-64" aria-label="New stage name" />
      <Button type="submit" size="sm" disabled={isPending}>
        Add stage
      </Button>
      <ErrorLine error={state.error} />
    </form>
  );
}

export function InstallSuggestedStagesButton() {
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  async function install() {
    setPending(true);
    const result = await installSuggestedStages();
    setPending(false);
    setMessage(result.error ?? (result.created ? `Added ${result.created} stage(s).` : "All suggested stages already exist."));
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={install}>
        Install suggested stages
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </span>
  );
}

export function StageRowControls({ stageId, name, archived, first, last }: { stageId: string; name: string; archived: boolean; first: boolean; last: boolean }) {
  const [state, formAction, isPending] = useActionState(renameStage, INITIAL);
  const [error, setError] = React.useState<string | null>(null);
  async function run(fn: () => Promise<FormActionState>) {
    const result = await fn();
    setError(result.error);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="stageId" value={stageId} />
        <Input name="name" defaultValue={name} maxLength={60} className="w-56" aria-label={`Rename ${name}`} />
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          Rename
        </Button>
      </form>
      <Button type="button" variant="ghost" size="sm" disabled={first} onClick={() => run(() => moveStage({ stageId, direction: "up" }))} aria-label={`Move ${name} up`}>
        ↑
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={last} onClick={() => run(() => moveStage({ stageId, direction: "down" }))} aria-label={`Move ${name} down`}>
        ↓
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => run(() => setStageArchived({ stageId, archived: !archived }))}>
        {archived ? "Restore" : "Archive"}
      </Button>
      <ErrorLine error={state.error ?? error} />
    </div>
  );
}

/**
 * Matter stage selector. Only active stages are offered for a new choice;
 * a matter already in an archived stage keeps showing it. Changing the
 * stage never closes or reopens the matter.
 */
export function MatterStageForm({
  matterId,
  currentStage,
  stages,
}: {
  matterId: string;
  currentStage: { id: string; name: string; archived: boolean } | null;
  stages: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(setMatterStage, INITIAL);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="matterId" value={matterId} />
      <Select name="stageId" defaultValue={currentStage?.id ?? ""} className="w-56" aria-label="Case stage">
        <option value="">No stage</option>
        {currentStage?.archived && (
          <option value={currentStage.id} disabled>
            {currentStage.name} (archived)
          </option>
        )}
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "Saving…" : "Set stage"}
      </Button>
      <ErrorLine error={state.error} />
    </form>
  );
}
