import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
