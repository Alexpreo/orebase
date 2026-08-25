import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { isAdmin } from "@/lib/admin-auth";
import { listChats } from "@/lib/chat";

// Rendered per-request so the Clerk-backed shell is never statically
// prerendered without credentials present.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [chats, showAdmin] = await Promise.all([listChats(), isAdmin()]);

  return (
    <SidebarProvider>
      <AppSidebar chats={chats} showAdmin={showAdmin} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium text-muted-foreground">
            OreBase
          </span>
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
