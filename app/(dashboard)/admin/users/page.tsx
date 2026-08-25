import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listPendingUsersForAdmin, listUsersForAdmin } from "@/lib/admin/users/queries";
import { CreateUserForm } from "./create-user-form";
import { UserRow } from "./user-row";

export default async function AdminUsersPage() {
  const currentAdmin = await requireCurrentUser();
  assertIsAdmin(currentAdmin);

  const [users, pendingUsers] = await Promise.all([listUsersForAdmin(), listPendingUsersForAdmin()]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Users &amp; Access</h1>
        <p className="text-sm text-muted-foreground">
          Fictional development users only — no real staff accounts exist yet.
        </p>
      </div>

      {pendingUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending approvals</CardTitle>
            <CardDescription>
              Self-registered accounts awaiting a role assignment — until approved, they cannot sign in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingUsers.map((user) => (
              <UserRow key={user.id} user={user} isCurrentAdmin={false} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add employee</CardTitle>
          <CardDescription>
            A temporary password is generated for you to hand off — it is shown exactly once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateUserForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
          <CardDescription>Role, status, MFA requirement, password reset, and account removal for each account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {users.map((user) => (
            <UserRow key={user.id} user={user} isCurrentAdmin={user.id === currentAdmin.id} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
