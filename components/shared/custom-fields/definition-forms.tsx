"use client";

import * as React from "react";
import { useActionState } from "react";
import type { CustomFieldEntity, CustomFieldType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomFieldDefinition,
  setCustomFieldDefinitionArchived,
  updateCustomFieldDefinition,
  type FormActionState,
} from "@/lib/custom-fields/actions";
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_ENTITY_VALUES,
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPE_VALUES,
} from "@/lib/custom-fields/values";

const INITIAL: FormActionState = { error: null };

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="text-sm font-medium text-destructive" role="alert">
      {error}
    </p>
  ) : null;
}

/** ADMIN: define a new custom field. The key is permanent once created. */
export function NewCustomFieldForm() {
  const [state, formAction, isPending] = useActionState(createCustomFieldDefinition, INITIAL);
  const [type, setType] = React.useState<CustomFieldType>("SHORT_TEXT");
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">New custom field</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cf-entity">Applies to</Label>
          <Select id="cf-entity" name="entity" defaultValue="MATTER">
            {CUSTOM_FIELD_ENTITY_VALUES.map((e) => (
              <option key={e} value={e}>
                {CUSTOM_FIELD_ENTITY_LABELS[e]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-type">Type</Label>
          <Select id="cf-type" name="type" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
            {CUSTOM_FIELD_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {CUSTOM_FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-label">Label</Label>
          <Input id="cf-label" name="label" required maxLength={100} placeholder="e.g. Arresting agency" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-key">Key (optional, permanent)</Label>
          <Input id="cf-key" name="key" maxLength={40} placeholder="auto from label, e.g. arresting_agency" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cf-help">Help text (optional)</Label>
          <Input id="cf-help" name="helpText" maxLength={300} />
        </div>
        {type === "SINGLE_SELECT" && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cf-options">Options (one per line)</Label>
            <Textarea id="cf-options" name="optionsText" rows={4} />
          </div>
        )}
      </div>
      <ErrorLine error={state.error} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create field"}
        </Button>
      </div>
    </form>
  );
}

export type DefinitionRow = {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  helpText: string | null;
  type: CustomFieldType;
  position: number;
  options: { id: string; label: string; archived: boolean }[];
  archived: boolean;
  valueCount: number;
};

/** ADMIN: edit one definition. Type is locked once values exist; options can be retired, not deleted. */
export function EditCustomFieldForm({ def }: { def: DefinitionRow }) {
  const [state, formAction, isPending] = useActionState(updateCustomFieldDefinition, INITIAL);
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<CustomFieldType>(def.type);
  const [archiveError, setArchiveError] = React.useState<string | null>(null);
  const [prev, setPrev] = React.useState(state);
  if (state !== prev) {
    setPrev(state);
    if (!state.error) setOpen(false);
  }

  async function toggleArchive() {
    const result = await setCustomFieldDefinitionArchived({ definitionId: def.id, archived: !def.archived });
    setArchiveError(result.error);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Edit"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={toggleArchive}>
          {def.archived ? "Restore" : "Archive"}
        </Button>
      </div>
      <ErrorLine error={archiveError} />
      {open && (
        <form action={formAction} className="space-y-3 rounded-md border border-border p-3">
          <input type="hidden" name="definitionId" value={def.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`l-${def.id}`}>Label</Label>
              <Input id={`l-${def.id}`} name="label" required maxLength={100} defaultValue={def.label} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`t-${def.id}`}>Type{def.valueCount > 0 ? " (locked — values exist)" : ""}</Label>
              {def.valueCount > 0 ? (
                <>
                  <input type="hidden" name="type" value={def.type} />
                  <Input id={`t-${def.id}`} value={CUSTOM_FIELD_TYPE_LABELS[def.type]} disabled readOnly />
                </>
              ) : (
                <Select id={`t-${def.id}`} name="type" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
                  {CUSTOM_FIELD_TYPE_VALUES.map((t) => (
                    <option key={t} value={t}>
                      {CUSTOM_FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`p-${def.id}`}>Order</Label>
              <Input id={`p-${def.id}`} name="position" type="number" min={0} max={10000} defaultValue={def.position} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor={`h-${def.id}`}>Help text</Label>
              <Input id={`h-${def.id}`} name="helpText" maxLength={300} defaultValue={def.helpText ?? ""} />
            </div>
          </div>
          {(def.valueCount > 0 ? def.type : type) === "SINGLE_SELECT" && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Options</p>
              {def.options.map((o) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input type="hidden" name="optionId" value={o.id} />
                  <Input name="optionLabel" aria-label="Option label" defaultValue={o.label} maxLength={100} className="max-w-xs" />
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="optionArchived" value={o.id} defaultChecked={o.archived} />
                    Retired
                  </label>
                </div>
              ))}
              <Label htmlFor={`n-${def.id}`}>Add options (one per line)</Label>
              <Textarea id={`n-${def.id}`} name="newOptionsText" rows={2} />
            </div>
          )}
          <ErrorLine error={state.error} />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save field"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
