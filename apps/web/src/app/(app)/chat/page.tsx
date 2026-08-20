import { redirect } from "next/navigation";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.q;
  const q = Array.isArray(raw) ? raw[0] : raw;
  const id = crypto.randomUUID();
  if (q) {
    redirect(`/chat/${id}?q=${encodeURIComponent(q)}`);
  }
  redirect(`/chat/${id}`);
}
