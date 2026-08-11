import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listUsersForAdmin } from "@/lib/admin/users/queries";
import { CreateUserForm } from "./create-user-form";
import { UserRow } from "./user-row";

export default async function AdminUsersPage() {
  const currentAdmin = await requireCurrentUser();
  assertIsAdmin(currentAdmin);

  const users = await listUsersForAdmin();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">User management</h1>
        <p className="text-sm text-muted-foreground">
          Fictional development users only — no real staff accounts exist yet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create user</CardTitle>
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
          <CardDescription>Role, activation, MFA requirement, and MFA reset for each account.</CardDescription>
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
