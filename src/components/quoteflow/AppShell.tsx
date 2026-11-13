import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Workflow,
  Inbox,
  Boxes,
  Package as PackageIcon,
  GitBranch,
  FileText,
  Plug,
  Settings,
  ChevronsUpDown,
  Check,
  Lock,
  ArrowRight,
  Database,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminLoginServerFn,
  adminLogoutServerFn,
  getAdminSessionServerFn,
} from "@/lib/quoteflow/server-fns";
import {
  checkLegacyLocalData,
  dismissLegacyLocalData,
  importLegacyLocalData,
  syncFromServer,
  useSyncStatus,
  type LegacyLocalDataSummary,
} from "@/lib/quoteflow/store";
import { RefreshCw, AlertTriangle } from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/flows", label: "Flows", icon: Workflow },
  { to: "/enquiries", label: "Enquiries", icon: Inbox },
  { to: "/packages", label: "Packages", icon: PackageIcon },
  { to: "/products", label: "Products", icon: Boxes },
  { to: "/rules", label: "Rules", icon: GitBranch },
  { to: "/proposals", label: "Proposals", icon: FileText },
  { to: "/connections", label: "Connections", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-brand-foreground text-[13px] font-bold">
        Q
      </span>
      <span className="text-[15px] font-semibold tracking-tight">QuoteFlow</span>
    </div>
  );
}

function Sidebar({ onSignOut }: { onSignOut: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {nav.map((item) => {
          const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <item.icon className={cn("h-4 w-4 text-muted-foreground", active && "text-brand")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent">
            <span className="grid h-6 w-6 place-items-center rounded bg-foreground text-[10px] font-semibold text-background">
              MV
            </span>
            <span className="flex-1 truncate text-[13px] font-medium">Marquee Ventures</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs">Workspaces</DropdownMenuLabel>
            <DropdownMenuItem className="justify-between">
              Marquee Ventures <Check className="h-3.5 w-3.5 text-brand" />
            </DropdownMenuItem>
            <DropdownMenuItem>Harbour House Catering</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Create workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand">
              RK
            </span>
            <span className="flex-1 truncate">
              <span className="block text-[13px] font-medium leading-tight">Ravi Kumar</span>
              <span className="block text-[11px] leading-tight text-muted-foreground">Owner</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem asChild>
              <Link to="/settings">Account settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>Invite teammate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [passcode, setPasscode] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const { syncStatus, lastSyncError } = useSyncStatus();

  const [legacyInfo, setLegacyInfo] = useState<{
    hasLegacy: boolean;
    summary: LegacyLocalDataSummary | null;
  }>({ hasLegacy: false, summary: null });
  const [overrideCatalog, setOverrideCatalog] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migratedSuccess, setMigratedSuccess] = useState<string | null>(null);

  useEffect(() => {
    getAdminSessionServerFn()
      .then((res) => {
        setIsAuthenticated(res.authenticated);
        if (res.authenticated) {
          syncFromServer();
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
      });

    const check = checkLegacyLocalData();
    if (check.hasLegacy) {
      setLegacyInfo({ hasLegacy: true, summary: check.summary });
    }
  }, []);

  // Listen to window focus to keep server state fresh across browser tabs/devices
  useEffect(() => {
    if (!isAuthenticated) return;
    const onFocus = () => {
      syncFromServer();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) {
      setAuthError("Please enter your administrator passcode.");
      return;
    }
    setAuthError(null);
    setIsLoggingIn(true);
    try {
      const res = await adminLoginServerFn({ data: { passcode: passcode.trim() } });
      if (res.success) {
        setIsAuthenticated(true);
        await syncFromServer();
      } else {
        setAuthError(res.error || "Incorrect passcode.");
      }
    } catch (err) {
      setAuthError((err as Error).message || "Login failed.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await adminLogoutServerFn();
    } catch {
      // ignore
    }
    setIsAuthenticated(false);
  };

  const handleSyncLocalData = async () => {
    setIsMigrating(true);
    try {
      const res = await importLegacyLocalData({ overrideCatalog });
      if (res.success) {
        setLegacyInfo({ hasLegacy: false, summary: null });
        const c = res.importedCounts;
        const msg = c
          ? `✓ Imported ${c.flows} flow(s), ${c.products} product(s), ${c.packages} package(s), ${c.enquiries} enquiry(s) into shared SQLite!`
          : "✓ Workspace data successfully synced to the shared server database!";
        setMigratedSuccess(msg);
        setTimeout(() => setMigratedSuccess(null), 4000);
      } else {
        alert(`Migration error: ${res.error || "Unknown error"}`);
      }
    } catch (err) {
      alert(`Migration error: ${(err as Error).message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  // Loading state while checking administrator session
  if (isAuthenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-brand-foreground text-[13px] font-bold">
            Q
          </span>
          <span>Loading QuoteFlow workspace…</span>
        </div>
      </div>
    );
  }

  // Auth gate check
  if (isAuthenticated === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-6 text-foreground">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="flex items-center justify-center">
            <Logo />
          </div>
          <h2 className="mt-5 text-center font-serif text-2xl font-semibold">Admin Sign In</h2>
          <p className="mt-1 text-center text-[13px] text-muted-foreground">
            Enter your passcode to manage proposals and quotes.
          </p>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <Input
                type="password"
                placeholder="Administrator passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoFocus
              />
            </div>
            {authError && <p className="text-[12px] font-medium text-destructive">{authError}</p>}
            <Button
              type="submit"
              className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? "Verifying…" : "Sign In to Workspace"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar onSignOut={handleSignOut} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sync Status / Error Banner */}
        {syncStatus === "error" && lastSyncError && (
          <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-[12.5px] text-destructive">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>{lastSyncError}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => syncFromServer()}
            >
              <RefreshCw className="mr-1 h-3 w-3" /> Retry Sync
            </Button>
          </div>
        )}

        {/* Local storage migration notice */}
        {legacyInfo.hasLegacy && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-50 px-6 py-2.5 text-[12.5px] text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Local browser data detected: Found{" "}
                <strong>{legacyInfo.summary?.flowsCount ?? 0}</strong> flows,{" "}
                <strong>{(legacyInfo.summary?.productsCount ?? 0) + (legacyInfo.summary?.packagesCount ?? 0)}</strong>{" "}
                products/packages, and <strong>{legacyInfo.summary?.enquiriesCount ?? 0}</strong> enquiries in this
                browser&apos;s local storage.
              </span>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[11.5px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideCatalog}
                  onChange={(e) => setOverrideCatalog(e.target.checked)}
                  className="rounded border-amber-400"
                />
                Apply local catalog edits
              </label>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[12px] bg-amber-100 dark:bg-amber-900 border-amber-400"
                disabled={isMigrating}
                onClick={handleSyncLocalData}
              >
                {isMigrating ? "Merging…" : "Review & Merge into Server"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[12px]"
                onClick={() => {
                  dismissLegacyLocalData();
                  setLegacyInfo({ hasLegacy: false, summary: null });
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {migratedSuccess && (
          <div className="border-b border-emerald-500/30 bg-emerald-50 px-6 py-2 text-[12.5px] font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            {migratedSuccess}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const { syncStatus } = useSyncStatus();

  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-background px-6 py-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Refresh from server"
            onClick={() => syncFromServer()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncStatus === "syncing" && "animate-spin text-brand")} />
          </Button>
        </div>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    live: "bg-brand-soft text-brand",
    approved: "bg-brand-soft text-brand",
    accepted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    qualified: "bg-brand-soft text-brand",
    draft: "bg-muted text-muted-foreground",
    new: "bg-secondary text-foreground",
    paused: "bg-muted text-muted-foreground",
    sent: "bg-secondary text-foreground",
    review: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    changes_requested: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    declined: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    quoted: "bg-secondary text-foreground",
    lost: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        map[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
