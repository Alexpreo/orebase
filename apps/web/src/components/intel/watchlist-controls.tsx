"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function WatchlistControls({
  itemId,
  alertsOn,
}: {
  itemId?: string;
  alertsOn: boolean;
}) {
  const router = useRouter();

  async function remove() {
    if (!itemId) return;
    await fetch("/api/watchlists/items", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: itemId }),
    });
    router.refresh();
  }

  async function toggleAlerts() {
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !alertsOn }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {itemId ? (
        <Button size="xs" variant="ghost" onClick={() => void remove()}>
          Remove
        </Button>
      ) : (
        <Button size="sm" variant={alertsOn ? "secondary" : "outline"} onClick={() => void toggleAlerts()}>
          {alertsOn ? "Alerts on" : "Alerts off"}
        </Button>
      )}
    </div>
  );
}
