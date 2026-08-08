import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";

import { getMatterHeader } from "@/lib/matters/queries";
import {
  assignmentRoleLabel,
  formatClientName,
  matterStatusLabel,
  matterStatusVariant,
  matterTitle,
} from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { MatterTabs } from "@/components/shared/matter-tabs";

export default async function MatterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const matter = await getMatterHeader(matterId);

  if (!matter) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/matters"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All matters
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{matterTitle(matter)}</h1>
              <Badge variant={matterStatusVariant(matter.status)}>
                {matterStatusLabel(matter.status)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {matter.caseNumber} &middot; {matter.charges} &middot; {matter.court}
            </p>
          </div>

          <div className="text-right text-sm text-muted-foreground">
            <p>Client: {formatClientName(matter.client)}</p>
            <p>
              Opened {format(matter.openedDate, "MMM d, yyyy")}
              {matter.closedDate ? ` · Closed ${format(matter.closedDate, "MMM d, yyyy")}` : ""}
            </p>
            {matter.assignments.length > 0 && (
              <p>
                {matter.assignments
                  .map((a) => `${a.user.name} (${assignmentRoleLabel(a.role)})`)
                  .join(", ")}
              </p>
            )}
          </div>
        </div>
      </div>

      <MatterTabs matterId={matter.id} />

      <div>{children}</div>
    </div>
  );
}
