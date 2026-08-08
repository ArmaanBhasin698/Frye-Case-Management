import { format } from "date-fns";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { getMatterDeadlines } from "@/lib/matters/queries";
import { deadlineTypeLabel } from "@/lib/matters/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function MatterDeadlinesPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const deadlines = await getMatterDeadlines(matterId);

  if (deadlines.length === 0) {
    return <p className="text-sm text-muted-foreground">No deadlines recorded for this matter.</p>;
  }

  return (
    <div className="space-y-3">
      {deadlines.map((deadline) => (
        <Card key={deadline.id}>
          <CardContent className="flex items-start justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              {deadline.satisfied ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">{deadline.description}</p>
                <p className="text-xs text-muted-foreground">
                  {deadlineTypeLabel(deadline.type)} &middot; {format(deadline.date, "MMM d, yyyy")}
                </p>
              </div>
            </div>
            <Badge variant={deadline.satisfied ? "success" : "outline"}>
              {deadline.satisfied ? "Satisfied" : "Upcoming"}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
