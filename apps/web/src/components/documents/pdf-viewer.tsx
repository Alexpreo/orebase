"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const DEFAULT_SCALE = 1.25;

// Rendering at the device pixel ratio keeps small type in resource tables legible on
// retina displays, but uncapped it wastes memory on 250-page documents.
const MAX_PIXEL_RATIO = 2;

type PdfViewerProps = {
  /** Route that redirects to a presigned URL for the rendered PDF. */
  fileUrl: string;
  /** 1-based page to open at, so a citation can deep-link to its source page. */
  initialPage?: number;
  className?: string;
};

/**
 * Loads pdf.js lazily and points it at the bundled worker.
 *
 * The import is deferred to first render because pdf.js touches browser globals at module
 * scope and must not be pulled into the server bundle.
 */
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

export function PdfViewer({ fileUrl, initialPage = 1, className }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [pageInput, setPageInput] = useState(String(Math.max(1, initialPage)));
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState(fileUrl);

  // Reset during render rather than in the effect below, so a new document never paints
  // one frame showing the previous document's page count or error.
  if (loadedUrl !== fileUrl) {
    setLoadedUrl(fileUrl);
    setPageCount(0);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;

    loadPdfJs()
      .then(async (pdfjs) => {
        const task = pdfjs.getDocument({ url: fileUrl });
        loadingTask = task;
        const pdf = await task.promise;
        if (cancelled) {
          return;
        }
        documentRef.current = pdf;
        setPageCount(pdf.numPages);
        setPage((current) => Math.min(Math.max(1, current), pdf.numPages));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load this document.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      documentRef.current = null;
      void loadingTask?.destroy();
    };
  }, [fileUrl]);

  useEffect(() => {
    const pdf = documentRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || pageCount === 0) {
      return;
    }

    let cancelled = false;

    (async () => {
      // pdf.js rejects concurrent renders into one canvas, and page changes can outpace
      // rendering, so the previous task is always cancelled first.
      renderTaskRef.current?.cancel();

      const pdfPage = await pdf.getPage(page);
      if (cancelled) {
        return;
      }

      const viewport = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const task = pdfPage.render({ canvas, canvasContext: context, viewport });
      renderTaskRef.current = task;

      try {
        await task.promise;
        if (!cancelled) {
          setLoading(false);
        }
      } catch (cause: unknown) {
        // A cancelled render is the expected outcome of paging quickly, not a failure.
        const name = (cause as { name?: string } | null)?.name;
        if (!cancelled && name !== "RenderingCancelledException") {
          setError("Could not render this page.");
          setLoading(false);
        }
      }
    })().catch(() => {
      if (!cancelled) {
        setError("Could not render this page.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [page, scale, pageCount]);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), pageCount || 1);
      setPage(clamped);
      setPageInput(String(clamped));
    },
    [pageCount],
  );

  const commitPageInput = useCallback(() => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(page));
      return;
    }
    goToPage(parsed);
  }, [goToPage, page, pageInput]);

  if (error) {
    return (
      <div className={cn("rounded-lg border border-destructive/40 bg-destructive/5 p-6", className)}>
        <p className="text-sm font-medium text-destructive">Could not display this document</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => goToPage(page + 1)}
          disabled={pageCount === 0 || page >= pageCount}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>

        <div className="flex items-center gap-1.5 text-sm">
          <Input
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={commitPageInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitPageInput();
              }
            }}
            className="h-9 w-16 text-center"
            aria-label="Page number"
            inputMode="numeric"
          />
          <span className="text-muted-foreground">
            of {pageCount || "—"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-12 text-center text-sm tabular-nums text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-[60vh] justify-center overflow-auto rounded-lg border bg-muted/30 p-4">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading document…
          </div>
        ) : null}
        <canvas ref={canvasRef} className="h-fit shadow-sm" />
      </div>
    </div>
  );
}
