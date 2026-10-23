"use client";

import * as React from "react";
import { useActionState } from "react";
import type { CustomFieldEntity, CustomFieldType } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveCustomFieldValues, type FormActionState } from "@/lib/custom-fields/actions";

export type CustomFieldFormRow = {
  id: string;
  label: string;
  helpText: string | null;
  type: CustomFieldType;
  options: { id: string; label: string; archived: boolean }[];
  input: string;
};

const INITIAL: FormActionState = { error: null };

/**
 * Edits one record's custom-field values. Submitted via onSubmit (not
 * `<form action>`) so a validation error doesn't reset what was typed.
 * The server re-checks edit rights and validates every value.
 */
export function CustomFieldsForm({ entity, ownerId, rows }: { entity: CustomFieldEntity; ownerId: string; rows: CustomFieldFormRow[] }) {
  const [state, formAction, isPending] = useActionState(saveCustomFieldValues, INITIAL);
  const [, startTransition] = React.useTransition();
  const [saved, setSaved] = React.useState(false);
  const [prev, setPrev] = React.useState(state);
  if (state !== prev) {
    setPrev(state);
    setSaved(!state.error);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSaved(false);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const name = `cf_${row.id}`;
          const inputId = `cf-${row.id}`;
          return (
            <div key={row.id} className={`space-y-1 ${row.type === "LONG_TEXT" ? "sm:col-span-2" : ""}`}>
              <Label htmlFor={inputId}>{row.label}</Label>
              {row.type === "LONG_TEXT" ? (
                <Textarea id={inputId} name={name} rows={3} defaultValue={row.input} maxLength={5000} />
              ) : row.type === "BOOLEAN" ? (
                <Select id={inputId} name={name} defaultValue={row.input}>
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              ) : row.type === "SINGLE_SELECT" ? (
                <Select id={inputId} name={name} defaultValue={row.input}>
                  <option value="">Not set</option>
                  {row.options
                    .filter((o) => !o.archived || o.id === row.input)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                        {o.archived ? " (retired)" : ""}
                      </option>
                    ))}
                </Select>
              ) : (
                <Input
                  id={inputId}
                  name={name}
                  type={row.type === "DATE" ? "date" : "text"}
                  inputMode={row.type === "NUMBER" ? "decimal" : undefined}
                  defaultValue={row.input}
                  maxLength={row.type === "SHORT_TEXT" ? 200 : undefined}
                />
              )}
              {row.helpText && <p className="text-xs text-muted-foreground">{row.helpText}</p>}
            </div>
          );
        })}
      </div>
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      {saved && !isPending && <p className="text-sm text-muted-foreground">Saved.</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save custom fields"}
        </Button>
      </div>
    </form>
  );
}
