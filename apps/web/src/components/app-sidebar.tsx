"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  Building2,
  FileText,
  MessagesSquare,
  Mountain,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { ChatSummary } from "@/lib/chat-types";

const NAV_ITEMS = [
  { title: "Chat", href: "/chat", icon: MessagesSquare },
  { title: "Screener", href: "/screener", icon: SlidersHorizontal },
  { title: "Watchlist", href: "/watchlist", icon: Star },
  { title: "Research", href: "/research", icon: Search },
  { title: "Companies", href: "/companies", icon: Building2 },
  { title: "Documents", href: "/documents", icon: FileText },
  { title: "Admin", href: "/admin", icon: ShieldCheck },
] as const;

export function AppSidebar({ chats = [] }: { chats?: ChatSummary[] }) {
  const pathname = usePathname();
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Mountain className="size-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">OreBase</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {chats.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Recent chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {chats.map((chat) => {
                  const href = `/chat/${chat.id}`;
                  return (
                    <SidebarMenuItem key={chat.id}>
                      <SidebarMenuButton
                        render={<Link href={href} />}
                        isActive={pathname === href}
                        tooltip={chat.title ?? "New chat"}
                      >
                        <span className="truncate">{chat.title ?? "New chat"}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1.5">
          {hasClerk ? (
            <UserButton
              appearance={{ elements: { avatarBox: "size-7" } }}
              showName
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              Auth disabled (no Clerk key)
            </span>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
