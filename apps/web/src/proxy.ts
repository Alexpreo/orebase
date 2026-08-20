import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/ingest(.*)",
]);

// Local development runs unauthenticated when no Clerk key is configured, so the
// app is usable before any account exists. Any deployment that sets the key gets
// full protection, and production always requires it.
const hasClerkKeys = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const authDisabled = !hasClerkKeys && process.env.NODE_ENV !== "production";

// clerkMiddleware only reads credentials when handling a request, so importing
// this module is safe even when Clerk keys are absent (e.g. at build time).
export default clerkMiddleware(async (auth, req) => {
  if (authDisabled) return;
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
