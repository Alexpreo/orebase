"use client";

import { useEffect, useMemo, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  href?: string;
};

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function MiniMap({
  points,
  className,
}: {
  points: Array<{
    id: string;
    name: string;
    lat: number | string | null;
    lng: number | string | null;
    href?: string;
  }>;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapped: MapPoint[] = useMemo(
    () =>
      points.flatMap((point) => {
        const lat = toNumber(point.lat);
        const lng = toNumber(point.lng);
        if (lat == null || lng == null) return [];
        return [{ id: point.id, name: point.name, lat, lng, href: point.href }];
      }),
    [points],
  );
  const signature = mapped.map((point) => `${point.id}:${point.lat}:${point.lng}`).join("|");

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapped.length === 0) return;
    let cancelled = false;
    let map: { remove: () => void } | undefined;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;
      const first = mapped[0];
      const instance = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: [first.lng, first.lat],
        zoom: mapped.length === 1 ? 6 : 3,
      });
      map = instance;
      instance.on("load", () => {
        for (const point of mapped) {
          const marker = new maplibregl.Marker().setLngLat([point.lng, point.lat]);
          const popup = new maplibregl.Popup({ offset: 16 });
          if (point.href) {
            const link = document.createElement("a");
            link.href = point.href;
            link.textContent = point.name;
            popup.setDOMContent(link);
          } else {
            popup.setText(point.name);
          }
          marker.setPopup(popup).addTo(instance);
        }
        if (mapped.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const point of mapped) bounds.extend([point.lng, point.lat]);
          instance.fitBounds(bounds, { padding: 40, maxZoom: 8 });
        }
      });
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [mapped, signature]);

  if (mapped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No coordinates yet. Load MinFile/USGS and run <code>geo.load --match</code>.
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className ?? "h-80 w-full overflow-hidden rounded-md border"}
    />
  );
}
