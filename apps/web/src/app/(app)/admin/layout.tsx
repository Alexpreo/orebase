import { isAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (await isAdmin()) {
    return children;
  }
  return (
    <div className="flex flex-col gap-2 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="text-sm text-muted-foreground">
        Not authorized. Add your Clerk user id to <code>ADMIN_CLERK_IDS</code>.
      </p>
    </div>
  );
}
