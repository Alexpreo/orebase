import "server-only";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export function clerkAuthEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export function adminAllowlist(): string[] {
  return (process.env.ADMIN_CLERK_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function isAdmin(): Promise<boolean> {
  if (!clerkAuthEnabled()) return true;
  const allow = adminAllowlist();
  if (allow.length === 0) return false;
  try {
    const { userId } = await auth();
    return Boolean(userId && allow.includes(userId));
  } catch {
    return false;
  }
}

export async function adminApiGuard(): Promise<NextResponse | null> {
  if (await isAdmin()) return null;
  return NextResponse.json({ error: "Admin access required." }, { status: 403 });
}
