import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
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

function Sidebar() {
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
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
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
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-background px-6 py-5">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    live: "bg-brand-soft text-brand",
    accepted: "bg-brand-soft text-brand",
    won: "bg-brand-soft text-brand",
    qualified: "bg-brand-soft text-brand",
    draft: "bg-muted text-muted-foreground",
    new: "bg-secondary text-foreground",
    paused: "bg-muted text-muted-foreground",
    sent: "bg-secondary text-foreground",
    review: "bg-amber-100 text-amber-800",
    quoted: "bg-secondary text-foreground",
    lost: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        map[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}
