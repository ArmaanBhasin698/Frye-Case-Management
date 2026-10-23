import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listStages } from "@/lib/stages/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InstallSuggestedStagesButton, NewStageForm, StageRowControls } from "@/components/shared/stages/stage-forms";

/**
 * ADMIN-only case-stage configuration. Stages track progress only — they
 * are separate from matter status, archive state, and the closure
 * workflow, and changing one never closes or reopens a matter.
 */
export default async function StagesAdminPage() {
  const user = await requireCurrentUser();
  assertIsAdmin(user);
  const stages = await listStages({ includeArchived: true });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">Case stages</h1>
        <p className="text-sm text-muted-foreground">
          Ordered progress stages for matters. Archived stages can&apos;t be newly assigned but stay visible on matters
          already in them. Stages never change a matter&apos;s open/closed status.
        </p>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>Stages</CardTitle>
          <InstallSuggestedStagesButton />
        </CardHeader>
        <CardContent className="space-y-4">
          <NewStageForm />
          {stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stages yet.</p>
          ) : (
            <ol className="divide-y divide-border">
              {stages.map((s, i) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-muted-foreground">{i + 1}.</span>
                    <span className="font-medium">{s.name}</span>
                    {s.archivedAt && <Badge variant="secondary">Archived</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {s._count.matters} matter{s._count.matters === 1 ? "" : "s"}
                    </span>
                  </div>
                  <StageRowControls stageId={s.id} name={s.name} archived={Boolean(s.archivedAt)} first={i === 0} last={i === stages.length - 1} />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
