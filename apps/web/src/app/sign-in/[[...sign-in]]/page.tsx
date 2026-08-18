import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
