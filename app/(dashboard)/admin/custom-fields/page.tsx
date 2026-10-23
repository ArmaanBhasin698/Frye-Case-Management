import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listCustomFieldDefinitions } from "@/lib/custom-fields/queries";
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_ENTITY_VALUES,
  CUSTOM_FIELD_TYPE_LABELS,
  parseOptions,
} from "@/lib/custom-fields/values";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditCustomFieldForm, NewCustomFieldForm } from "@/components/shared/custom-fields/definition-forms";

/**
 * ADMIN-only custom-field definitions for matters, contacts (including
 * organizations, which are Contacts), and clients. Archived fields are
 * hidden from forms but their stored values stay visible on records.
 */
export default async function CustomFieldsAdminPage() {
  const user = await requireCurrentUser();
  assertIsAdmin(user);
  const definitions = await listCustomFieldDefinitions(undefined, { includeArchived: true });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">Custom fields</h1>
        <p className="text-sm text-muted-foreground">
          Extra fields for matters, contacts/organizations, and clients. Keys are permanent; a field&apos;s type is
          locked once any value is recorded, and select options are retired rather than deleted so existing values stay
          readable.
        </p>
      </div>

      <NewCustomFieldForm />

      {CUSTOM_FIELD_ENTITY_VALUES.map((entity) => {
        const defs = definitions.filter((d) => d.entity === entity);
        return (
          <Card key={entity}>
            <CardHeader>
              <CardTitle>{CUSTOM_FIELD_ENTITY_LABELS[entity]}</CardTitle>
            </CardHeader>
            <CardContent>
              {defs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No custom fields yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {defs.map((d) => (
                    <li key={d.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{d.label}</span>
                        <code className="text-xs text-muted-foreground">{d.key}</code>
                        <Badge variant="outline">{CUSTOM_FIELD_TYPE_LABELS[d.type]}</Badge>
                        {d.archivedAt && <Badge variant="secondary">Archived</Badge>}
                        <span className="text-xs text-muted-foreground">
                          order {d.position} · {d._count.values} value{d._count.values === 1 ? "" : "s"}
                        </span>
                      </div>
                      {d.helpText && <p className="text-xs text-muted-foreground">{d.helpText}</p>}
                      <EditCustomFieldForm
                        def={{
                          id: d.id,
                          entity: d.entity,
                          key: d.key,
                          label: d.label,
                          helpText: d.helpText,
                          type: d.type,
                          position: d.position,
                          options: parseOptions(d.options),
                          archived: Boolean(d.archivedAt),
                          valueCount: d._count.values,
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
