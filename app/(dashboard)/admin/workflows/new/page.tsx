import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listActiveStaffOptions } from "@/lib/workflows/queries";
import { WorkflowTemplateEditor } from "@/components/shared/workflows/template-editor";

export default async function NewWorkflowTemplatePage() {
  const user = await requireCurrentUser();
  assertIsAdmin(user);
  const staff = await listActiveStaffOptions();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="page-title">New workflow template</h1>
      <WorkflowTemplateEditor staff={staff} />
    </div>
  );
}
