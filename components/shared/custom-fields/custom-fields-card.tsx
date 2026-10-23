import type { CustomFieldEntity } from "@prisma/client";

import { getCustomFieldRows } from "@/lib/custom-fields/queries";
import { parseOptions } from "@/lib/custom-fields/values";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomFieldsForm } from "@/components/shared/custom-fields/custom-fields-form";

/**
 * Custom fields for one record. Render only on a page that has already
 * authorized viewing the record; `canEdit` must come from the record's own
 * edit rule (lib/custom-fields/access.ts#canEditCustomValues) — the save
 * action re-checks it regardless. Archived definitions still show any value
 * the record holds, read-only, so history is never hidden.
 */
export async function CustomFieldsCard({
  entity,
  ownerId,
  canEdit,
}: {
  entity: CustomFieldEntity;
  ownerId: string;
  canEdit: boolean;
}) {
  const { active, archived } = await getCustomFieldRows(entity, ownerId);
  if (active.length === 0 && archived.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && active.length > 0 ? (
          <CustomFieldsForm
            entity={entity}
            ownerId={ownerId}
            rows={active.map((r) => ({
              id: r.definition.id,
              label: r.definition.label,
              helpText: r.definition.helpText,
              type: r.definition.type,
              options: parseOptions(r.definition.options),
              input: r.input,
            }))}
          />
        ) : (
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {active.map((r) => (
              <div key={r.definition.id}>
                <dt className="text-muted-foreground">{r.definition.label}</dt>
                <dd className="whitespace-pre-wrap">{r.display || "—"}</dd>
              </div>
            ))}
          </dl>
        )}
        {archived.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Retired fields</p>
            <dl className="mt-1 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {archived.map((r) => (
                <div key={r.definition.id}>
                  <dt className="text-muted-foreground">{r.definition.label}</dt>
                  <dd className="whitespace-pre-wrap">{r.display}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
