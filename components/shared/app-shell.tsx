"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  FileSearch,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Phone,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/shared/logout-button";
import { Logo } from "@/components/shared/logo";
import type { SessionUser } from "@/lib/auth/session";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

function roleLabel(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  disabledReason?: string;
  disabledBadge?: string;
};

/**
 * Clients is disabled for PARALEGAL/STAFF, not just for everyone — hiding
 * it here is a UI convenience, not the access control (the /clients pages
 * independently re-check the same role rule — see
 * lib/auth/authorization.ts#canManageClientsAndMatters and
 * docs/SECURITY.md). Every other item's disabled state is unrelated
 * scope-not-built-yet, unchanged from before this pass.
 */
function navItemsFor(role: string): NavItem[] {
  const canManageClients = role === "ADMIN" || role === "ATTORNEY";
  return [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/matters", label: "Matters", icon: FolderKanban },
    {
      href: "/clients",
      label: "Clients",
      icon: Users,
      disabled: !canManageClients,
      disabledReason: "Restricted to Admin/Attorney",
      disabledBadge: "Restricted",
    },
    { href: "/tasks", label: "Tasks", icon: CheckSquare },
    { href: "/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/discovery", label: "Discovery", icon: FileSearch },
    { href: "/communications", label: "Communications", icon: Phone },
    { href: "/reports", label: "Reports", icon: BarChart3 },
  ];
}

function SidebarContent({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const navItems = navItemsFor(role);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4">
        <div className="shrink-0 rounded-md bg-white p-1.5">
          <Logo size="sm" />
        </div>
        <p className="truncate text-xs text-sidebar-foreground/60">Case Management</p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          if (item.disabled) {
            return (
              <div
                key={item.href}
                className="flex cursor-not-allowed items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/40"
                title={item.disabledReason ?? "Not built yet"}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {item.label}
                </span>
                <span className="rounded-full bg-sidebar-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/60">
                  {item.disabledBadge ?? "Soon"}
                </span>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-4 text-xs text-sidebar-foreground/50">
        Groundwork build &middot; v0.1
      </div>
    </div>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 md:block">
        <SidebarContent role={user.role} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 h-full w-64 shadow-xl">
            <SidebarContent role={user.role} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-2 hover:bg-accent md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Logo size="sm" className="md:hidden" />
            <p className="hidden text-sm font-medium text-muted-foreground sm:block md:hidden">
              Internal case management
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/account/security"
              className="flex items-center gap-3 rounded-md px-1 py-1 hover:bg-accent"
              title="Two-factor authentication settings"
            >
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium leading-none text-foreground">{user.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{roleLabel(user.role)}</p>
              </div>
              <Badge variant="outline" className="sm:hidden">
                {roleLabel(user.role)}
              </Badge>
              <Avatar className="h-8 w-8">
                <AvatarFallback>{initials(user.name ?? user.email ?? "?")}</AvatarFallback>
              </Avatar>
            </Link>
            <LogoutButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
