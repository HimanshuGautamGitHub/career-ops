"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/modal";
import { PAGE_HEIGHT, PAGE_WIDTH, previewScale, scaledPageBox } from "@/lib/template-preview.mjs";

// The full, readable view of a CV/cover template, opened from clicking a card's
// thumbnail (Gap 1, AGEN-258). It reuses the same /api/templates/preview HTML the
// thumbnail already loads, rendered at the page's true size and scaled to fit the
// modal. The accessible shell (focus trap, Escape, backdrop-close, focus
// restoration) comes from <Modal>, so this only adds the preview and the one
// primary action the spec allows here — "Make default".

type Props = {
  kind: "cv" | "cover";
  name: string;
  displayName: string;
  isDefault: boolean;
  // The name currently being saved as default, or null when idle. Mirrors the
  // card's own busy logic so both surfaces agree on when the action is disabled.
  busy: string | null;
  onChoose: (name: string) => void;
  onClose: () => void;
};

export function TemplatePreviewModal({ kind, name, displayName, isDefault, busy, onChoose, onClose }: Props) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [availWidth, setAvailWidth] = useState(0);

  useEffect(() => {
    let live = true;
    setHtml(null);
    setFailed(false);
    fetch(`/api/templates/preview?kind=${kind}&name=${encodeURIComponent(name)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((h) => live && setHtml(h))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [kind, name]);

  // Measure the space the page may occupy and keep it current as the viewport
  // changes, so the scale fits the width without ever scrolling the modal sideways.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setAvailWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setAvailWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = previewScale(availWidth);
  const box = scaledPageBox(scale);

  return (
    <Modal isOpen onClose={onClose} labelledBy={headingId} initialFocusRef={closeRef} panelClassName="max-w-[880px] p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <h2 id={headingId} className="truncate text-base font-semibold text-foreground">
          {displayName}
        </h2>
        <div className="flex items-center gap-2">
          {isDefault ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Check className="size-3" aria-hidden /> Default
            </span>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onChoose(name)}
              className={cn(
                "rounded-md border border-border px-2 py-1 text-xs hover:bg-surface",
                busy !== null && "opacity-60",
              )}
            >
              {busy === name ? "Saving…" : "Make default"}
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-lg p-1.5 text-faint hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div ref={bodyRef} className="flex justify-center overflow-x-auto bg-neutral-100 p-4 dark:bg-neutral-900">
        {failed ? (
          <p className="py-12 text-sm text-muted">Preview unavailable.</p>
        ) : html === null ? (
          <Loader2 className="my-12 size-5 animate-spin text-muted" aria-label="Loading preview" />
        ) : (
          <div className="shrink-0 overflow-hidden rounded-md bg-white shadow-sm" style={{ width: box.width, height: box.height }}>
            <iframe
              title={`${displayName} preview`}
              srcDoc={html}
              sandbox=""
              tabIndex={-1}
              style={{
                width: PAGE_WIDTH,
                height: PAGE_HEIGHT,
                border: 0,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                pointerEvents: "none",
              }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
