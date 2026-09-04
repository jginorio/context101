"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Brain,
  Building2,
  ChevronUp,
  FolderTree,
  LogOut,
  Menu,
  Plug,
  Settings,
  Sparkles,
  User,
} from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { BrainSwitcher } from "@/components/brain-switcher";
import { SidebarBrainPanel } from "@/components/sidebar-brain-panel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BRAIN_ACCENT_RGB } from "@/lib/brain-accent";

const NAV_ITEMS = [
  { href: "/knowledge", label: "Knowledge", icon: FolderTree },
  { href: "/wiki", label: "Wiki", icon: BookOpen },
  { href: "/suggestions", label: "Suggestions", icon: Sparkles },
  { href: "/sources", label: "Sources", icon: Plug },
  { href: "/brains", label: "Brains", icon: Brain },
];

// Lets sidebar content (file tree, wiki nav) close the mobile sheet when the
// user navigates or selects something. A no-op on desktop. Pass `after` to
// run a callback once the sheet finish its close animation (used so a
// follow-up drawer does not fight the nav).
const AppShellContext = React.createContext<{
  closeMobileNav: (after?: () => void) => void;
}>({
  closeMobileNav: () => {},
});

export function useAppShell() {
  return React.useContext(AppShellContext);
}

function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-stretch gap-1 px-2">
      {NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={item.label}
            aria-label={item.label}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[10px] leading-none transition-colors",
              active
                ? "app-nav-active font-medium"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="w-full truncate text-center">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AccountMenu() {
  const { data } = authClient.useSession();
  const [signingOut, setSigningOut] = React.useState(false);

  const user = data?.user;
  const name = user?.name?.trim();
  const email = user?.email;
  const primary = name || email || "Account";

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } catch {
      // Fall through to the login page regardless — middleware re-gates the
      // session on the next request.
    }
    window.location.href = "/login?next=/knowledge";
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-2"
          />
        }
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25"
          style={{ boxShadow: `0 0 16px rgba(${BRAIN_ACCENT_RGB}, 0.14)` }}
        >
          <User className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className="max-w-40 truncate text-sm font-medium">
            {primary}
          </span>
          {name && email ? (
            <span className="max-w-40 truncate text-xs text-muted-foreground">
              {email}
            </span>
          ) : null}
        </span>
        <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{primary}</DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings className="mr-2 h-3.5 w-3.5" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/orgs" />}>
            <Building2 className="mr-2 h-3.5 w-3.5" /> Switch org
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={signOut}
          disabled={signingOut}
        >
          <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarInner({
  contextPanel,
  onNavigate,
}: {
  contextPanel?: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-2">
        <BrainSwitcher />
      </div>
      <div className="border-b border-sidebar-border/60 py-2">
        <AppNav onNavigate={onNavigate} />
      </div>
      {contextPanel ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border/60 p-2">
          {contextPanel}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border/60">
          <SidebarBrainPanel onNavigate={onNavigate} />
        </div>
      )}
      <div className="border-t border-sidebar-border p-2">
        <AccountMenu />
      </div>
    </div>
  );
}

export function AppShell({
  title,
  subtitle,
  toolbar,
  contextPanel,
  children,
}: {
  title: string;
  subtitle?: string;
  toolbar?: React.ReactNode;
  contextPanel?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const afterNavCloseRef = React.useRef<(() => void) | null>(null);
  const afterNavCloseTimer = React.useRef<number>(0);

  const closeMobileNav = React.useCallback((after?: () => void) => {
    window.clearTimeout(afterNavCloseTimer.current);
    if (!mobileNavOpen) {
      after?.();
      return;
    }
    afterNavCloseRef.current = after ?? null;
    setMobileNavOpen(false);
    if (after) {
      afterNavCloseTimer.current = window.setTimeout(() => {
        const fn = afterNavCloseRef.current;
        afterNavCloseRef.current = null;
        fn?.();
      }, 400);
    }
  }, [mobileNavOpen]);

  const handleNavOpenChange = React.useCallback((open: boolean) => {
    if (open) {
      window.clearTimeout(afterNavCloseTimer.current);
      afterNavCloseRef.current = null;
    }
    setMobileNavOpen(open);
  }, []);

  const handleNavOpenChangeComplete = React.useCallback((open: boolean) => {
    if (open) return;
    window.clearTimeout(afterNavCloseTimer.current);
    const fn = afterNavCloseRef.current;
    afterNavCloseRef.current = null;
    fn?.();
  }, []);

  return (
    <AppShellContext.Provider value={{ closeMobileNav }}>
      <main className="flex h-screen overflow-hidden">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
          <SidebarInner contextPanel={contextPanel} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-sm sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Sheet
                open={mobileNavOpen}
                onOpenChange={handleNavOpenChange}
                onOpenChangeComplete={handleNavOpenChangeComplete}
              >
                <SheetTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 md:hidden"
                      aria-label="Open menu"
                    />
                  }
                >
                  <Menu className="h-4 w-4" />
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[85vw] max-w-sm gap-0 p-0"
                >
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <SidebarInner
                    contextPanel={contextPanel}
                    onNavigate={() => closeMobileNav()}
                  />
                </SheetContent>
              </Sheet>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="hidden truncate text-xs text-muted-foreground sm:block">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            </div>
            {toolbar ? (
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                {toolbar}
              </div>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </main>
    </AppShellContext.Provider>
  );
}
