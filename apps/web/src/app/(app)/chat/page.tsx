import { redirect } from "next/navigation";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();
  for (const key of ["q", "company", "doc_type", "date_from", "date_to"] as const) {
    const value = firstValue(params[key]);
    if (value) next.set(key, value);
  }
  const id = crypto.randomUUID();
  const query = next.toString();
  redirect(query ? `/chat/${id}?${query}` : `/chat/${id}`);
}
