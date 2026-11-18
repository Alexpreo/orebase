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

// Explicit opt-in for keyless local development only; never honoured in production.
export function devAdminBypass(): boolean {
  return process.env.DEV_ADMIN_BYPASS === "true" && process.env.NODE_ENV !== "production";
}

export async function isAdmin(): Promise<boolean> {
  if (devAdminBypass()) return true;
  // Fail closed: without Clerk there is no identity to check against the allowlist.
  if (!clerkAuthEnabled()) return false;
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
  if (!clerkAuthEnabled() && !devAdminBypass()) {
    return NextResponse.json(
      { error: "Admin is unavailable: authentication is not configured." },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: "Admin access required." }, { status: 403 });
}
