"use client";

import { useEffect, useRef, useState } from "react";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";
import { exportHtmlOnly, exportZip, type ExportInput } from "@/lib/email/exportDesign";

// Email Studio — Export button (added 2026-11-16, per Chad / Eddie's ask: hand a
// design to an outside company to edit in their own tools). Used on each email
// card (Emails tab) and in the designer's top bar. Click → two choices:
// "Zip with pictures" or "HTML only". lib/email/exportDesign.ts does the work.
// getInput returns the design to export (the card loads it from the database;
// the designer passes what's on screen), or an error to show.

export default function EmailExportButton({
  getInput,
  variant = "link",
  disabled,
}: {
  getInput: () => Promise<ExportInput | { error: string }>;
  variant?: "link" | "button";
  disabled?: boolean;
}) {
  const isNew = useNewFeature("feature:email-studio-export");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "zip" | "html">(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function run(kind: "zip" | "html") {
    setBusy(kind);
    setMsg(null);
    try {
      const input = await getInput();
      if ("error" in input) {
        setMsg({ text: input.error, bad: true });
        return;
      }
      if (kind === "html") {
        const r = exportHtmlOnly(input);
        setMsg(r.ok ? { text: "Downloaded the HTML file." } : { text: r.error, bad: true });
      } else {
        const r = await exportZip(input);
        if (!r.ok) setMsg({ text: r.error, bad: true });
        else
          setMsg({
            text:
              `Downloaded the zip (${r.pictures} picture${r.pictures === 1 ? "" : "s"})` +
              (r.linked.length ? ` — ${r.linked.length} couldn't be downloaded and stay linked online (listed in README.txt).` : "."),
            bad: r.linked.length > 0,
          });
      }
      setOpen(false);
    } catch {
      setMsg({ text: "Couldn't export. Please try again.", bad: true });
    } finally {
      setBusy(null);
    }
  }

  const trigger =
    variant === "button"
      ? "rounded-full border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
      : "text-neutral-300 underline disabled:opacity-50";

  return (
    <div ref={boxRef} className="relative inline-flex flex-col">
      <button
        type="button"
        disabled={disabled || !!busy}
        onClick={() => {
          setOpen((v) => !v);
          setMsg(null);
          isNew.dismiss();
        }}
        className={trigger}
        title="Download this email to hand to someone outside FCB"
      >
        {busy ? "Exporting…" : "Export"}
        {isNew.isNew && <NewBadge inline />}
      </button>
      {open && (
        <div className={`absolute ${variant === "button" ? "right-0" : "left-0"} top-full z-30 mt-1 w-72 space-y-1 rounded-xl border border-neutral-700 bg-neutral-950 p-2 text-left shadow-xl`}>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("zip")}
            className="block w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-800"
          >
            <span className="block text-sm font-semibold text-neutral-100">Zip with pictures</span>
            <span className="block text-xs text-neutral-400">
              email.html + an images folder + a README. Best for handing to another company.
            </span>
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("html")}
            className="block w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-800"
          >
            <span className="block text-sm font-semibold text-neutral-100">HTML only</span>
            <span className="block text-xs text-neutral-400">One file. Pictures stay linked to where they&apos;re stored online.</span>
          </button>
          <p className="px-3 pb-1 pt-1 text-[11px] text-neutral-500">
            The FCB address + unsubscribe footer isn&apos;t included — their email service adds its own.
          </p>
        </div>
      )}
      {msg && (
        <span className={`mt-1 max-w-xs text-xs ${msg.bad ? "text-amber-300" : "text-green-300"}`}>{msg.text}</span>
      )}
    </div>
  );
}
