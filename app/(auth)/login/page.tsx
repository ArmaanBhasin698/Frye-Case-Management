import { Scale } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Scale className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Frye Law Group</h1>
            <p className="text-sm text-muted-foreground">Case Management</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Internal staff access only.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm callbackUrl={callbackUrl ?? "/"} />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Development preview &mdash; fictional accounts only. See README for demo credentials.
        </p>
      </div>
    </div>
  );
}
