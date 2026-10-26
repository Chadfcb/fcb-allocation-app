"use client";

// Our Inventory — running record (Inventory & Allocation, weeks from
// 10/26/2026 on) — added 2026-10-26. Plan: claude/ekos-packaging-inventory-plan.md.
// SQL: sql/inventory_running_record.sql.
//
// On Hand is no longer typed in. It's the last count + what Ekos says was
// packaged − orders marked Delivered − Other out. This panel is where people:
//   - Enter count      (the physical count; saved with what the record said)
//   - Other out        (taproom / samples / breakage / dumped)
//   - Labeled          (unlabeled cases labeled → move to On Hand; their
//                       labels and Pak-Techs come off then)
// and see:
//   - Delivered        (every delivered order and what went out)
//   - Count Differences (record vs count at each count — where beer goes missing)
//   - Activity         (every change, newest first, incl. Ekos packaging runs)
// Entries are never edited; Undo adds an opposite entry.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import { derivePackaging } from "@/lib/packaging";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import type { Product } from "@/lib/types/db";

// First day whose Ekos packaging counts (public.inventory_record_start()).
const RECORD_START = "2026-10-27";
const OTHER_OUT_REASONS = ["Taproom", "Samples", "Breakage", "Dumped", "Other"];

type Bucket = "labeled" | "unlabeled";
type Kind = "count" | "delivered" | "undelivered" | "other_out" | "other_out_undo" | "labeled";

interface Move {
  id: string;
  product_id: string;
  bucket: Bucket;
  kind: Kind;
  qty: number;
  record_qty: number | null;
  happened_at: string;
  week_id: string | null;
  distributor_id: string | null;
  distributor_po_id: string | null;
  po_number: string | null;
  reason: string | null;
  note: string | null;
  reverses_id: string | null;
  group_id: string | null;
}

interface Run {
  task_rowguid: string;
  batch_title: string | null;
  item_title: string;
  packaged_on: string;
  units: number;
  status_title: string | null;
  unlabeled: boolean;
  product_id: string | null;
  needs_decision: boolean;
  skipped: boolean;
}

interface Level {
  product_id: string;
  on_hand: number;
  unlabeled: number;
}

type Tab = "count" | "other" | "labeled" | "delivered" | "differences" | "activity";

const BTN = "rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800";
const BTN_ON = "rounded border border-[#6ABC46] bg-[#6ABC46]/15 px-2.5 py-1 text-xs text-neutral-100";
const INPUT = "rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-100";

const n = (v: unknown) => Number(v) || 0;
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(iso));
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
const todayPacific = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const addDay = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export default function InventoryRecordPanel({
  weekId,
  products,
  userId,
  onChanged,
}: {
  weekId: string;
  products: Product[];
  userId: string;
  onChanged: () => void | Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const badge = useNewFeature("feature:inventory-record");
  const [tab, setTab] = useState<Tab | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [distNames, setDistNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // forms
  const [countVals, setCountVals] = useState<Record<string, string>>({}); // `${productId}:${bucket}` → typed number
  const [countAfterPackaging, setCountAfterPackaging] = useState(false);
  const [ooProduct, setOoProduct] = useState("");
  const [ooBucket, setOoBucket] = useState<Bucket>("labeled");
  const [ooQty, setOoQty] = useState("");
  const [ooReason, setOoReason] = useState("");
  const [ooNote, setOoNote] = useState("");
  const [lbProduct, setLbProduct] = useState("");
  const [lbQty, setLbQty] = useState("");

  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const nameOf = useCallback((id: string | null) => (id ? productName.get(id) ?? "Archived product" : "—"), [productName]);
  // Tap handles aren't beer.
  const beerProducts = useMemo(() => products.filter((p) => derivePackaging(p.name).kind !== "tap_handle"), [products]);
  const canProducts = useMemo(() => products.filter((p) => derivePackaging(p.name).kind === "can"), [products]);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const runsFrom = (() => {
      const d = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
      return d > RECORD_START ? d : RECORD_START;
    })();
    const [m, r, l, d] = await Promise.all([
      supabase
        .from("inventory_moves")
        .select("id, product_id, bucket, kind, qty, record_qty, happened_at, week_id, distributor_id, distributor_po_id, po_number, reason, note, reverses_id, group_id")
        .gte("happened_at", since)
        .order("happened_at", { ascending: false })
        .limit(2000),
      supabase.rpc("inventory_packaging_runs", { p_from: runsFrom }),
      supabase.rpc("inventory_record_levels"),
      supabase.from("distributors").select("id, name"),
    ]);
    setMoves(((m.data ?? []) as Move[]).map((x) => ({ ...x, qty: n(x.qty), record_qty: x.record_qty === null ? null : n(x.record_qty) })));
    setRuns(((r.data ?? []) as Run[]).map((x) => ({ ...x, units: n(x.units) })));
    const lv: Record<string, Level> = {};
    for (const x of (l.data ?? []) as Level[]) lv[x.product_id] = { product_id: x.product_id, on_hand: n(x.on_hand), unlabeled: n(x.unlabeled) };
    setLevels(lv);
    const dn: Record<string, string> = {};
    for (const x of (d.data ?? []) as { id: string; name: string }[]) dn[x.id] = x.name;
    setDistNames(dn);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load, weekId]);

  // Live: someone else's count / Other out, or an order marked Delivered.
  useEffect(() => {
    const channel = supabase
      .channel("inventory-record")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "inventory_moves" }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  function openTab(t: Tab) {
    badge.dismiss();
    setError(null);
    setDone(null);
    setTab((prev) => (prev === t ? null : t));
  }

  async function save(rows: Record<string, unknown>[], message: string) {
    setSaving(true);
    setError(null);
    setDone(null);
    const { data, error: err } = await supabase.from("inventory_moves").insert(rows).select("id, kind, qty, bucket");
    if (err) {
      setSaving(false);
      setError(`Couldn't save: ${err.message}`);
      return false;
    }
    await Promise.all(
      ((data ?? []) as { id: string; kind: string; qty: number; bucket: string }[]).map((r) =>
        logChange(supabase, {
          weekId,
          tableName: "inventory_moves",
          recordId: r.id,
          fieldName: "qty",
          oldValue: null,
          newValue: `${r.kind} ${r.bucket} ${r.qty}`,
          changedBy: userId,
        })
      )
    );
    await load();
    await onChanged();
    setSaving(false);
    setDone(message);
    return true;
  }

  // ---- Enter count ---------------------------------------------------------
  async function submitCount() {
    const rows: Record<string, unknown>[] = [];
    for (const [key, raw] of Object.entries(countVals)) {
      if (raw.trim() === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        setError("Counts must be 0 or more.");
        return;
      }
      const [productId, bucket] = key.split(":");
      rows.push({
        product_id: productId,
        bucket,
        kind: "count",
        qty: v,
        packaging_from: countAfterPackaging ? addDay(todayPacific()) : todayPacific(),
      });
    }
    if (rows.length === 0) {
      setError("Type at least one counted number first.");
      return;
    }
    if (await save(rows, `Count saved for ${rows.length} line${rows.length === 1 ? "" : "s"}. Any difference from the record is under Count Differences.`)) {
      setCountVals({});
    }
  }

  // ---- Other out -----------------------------------------------------------
  async function submitOtherOut() {
    const q = Number(ooQty);
    if (!ooProduct) return setError("Pick a beer.");
    if (!Number.isFinite(q) || q <= 0) return setError("Enter how many came out (more than 0).");
    if (!ooReason) return setError("Pick a reason.");
    const ok = await save(
      [{ product_id: ooProduct, bucket: ooBucket, kind: "other_out", qty: -q, reason: ooReason, note: ooNote.trim() || null }],
      `${q} × ${nameOf(ooProduct)} taken out (${ooReason}).`
    );
    if (ok) {
      setOoQty("");
      setOoNote("");
    }
  }

  // ---- Labeled -------------------------------------------------------------
  async function submitLabeled() {
    const q = Number(lbQty);
    if (!lbProduct) return setError("Pick a beer.");
    if (!Number.isFinite(q) || q <= 0) return setError("Enter how many cases were labeled (more than 0).");
    const group = crypto.randomUUID();
    const ok = await save(
      [
        { product_id: lbProduct, bucket: "unlabeled", kind: "labeled", qty: -q, group_id: group },
        { product_id: lbProduct, bucket: "labeled", kind: "labeled", qty: q, group_id: group },
      ],
      `${q} × ${nameOf(lbProduct)} moved from Unlabeled to On Hand.`
    );
    if (ok) setLbQty("");
  }

  // ---- Undo (Other out / Labeled) -----------------------------------------
  const undone = useMemo(() => new Set(moves.map((m) => m.reverses_id).filter(Boolean) as string[]), [moves]);
  async function undo(m: Move) {
    if (m.kind === "other_out") {
      await save(
        [{ product_id: m.product_id, bucket: m.bucket, kind: "other_out_undo", qty: -m.qty, reason: m.reason, reverses_id: m.id }],
        "Other out undone."
      );
      return;
    }
    if (m.kind === "labeled" && m.group_id) {
      const pair = moves.filter((x) => x.group_id === m.group_id && x.kind === "labeled" && !x.reverses_id);
      const group = crypto.randomUUID();
      await save(
        pair.map((x) => ({ product_id: x.product_id, bucket: x.bucket, kind: "labeled", qty: -x.qty, group_id: group, reverses_id: x.id })),
        "Labeled undone."
      );
    }
  }

  // ---- Delivered -----------------------------------------------------------
  const delivered = useMemo(() => {
    const byOrder = new Map<string, { key: string; po: string | null; dist: string | null; at: string; lines: Map<string, number> }>();
    for (const m of moves) {
      if (m.kind !== "delivered" && m.kind !== "undelivered") continue;
      const key = `${m.week_id}:${m.distributor_id}`;
      const o = byOrder.get(key) ?? { key, po: m.po_number, dist: m.distributor_id, at: m.happened_at, lines: new Map<string, number>() };
      if (m.happened_at > o.at) o.at = m.happened_at;
      o.lines.set(m.product_id, (o.lines.get(m.product_id) ?? 0) + m.qty);
      byOrder.set(key, o);
    }
    return [...byOrder.values()]
      .map((o) => ({ ...o, lines: [...o.lines.entries()].filter(([, q]) => q < 0) }))
      .filter((o) => o.lines.length > 0)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [moves]);

  // ---- Count Differences ---------------------------------------------------
  const differences = useMemo(
    () => moves.filter((m) => m.kind === "count" && m.record_qty !== null && m.qty !== m.record_qty),
    [moves]
  );

  // ---- Activity ------------------------------------------------------------
  const activity = useMemo(() => {
    const items: { at: string; text: string; amount: string; tone: "plus" | "minus" | "count" | "warn"; move?: Move }[] = [];
    const where = (b: Bucket) => (b === "unlabeled" ? " (Unlabeled)" : "");
    for (const m of moves) {
      if (m.kind === "count") {
        items.push({
          at: m.happened_at,
          text: `Count — ${nameOf(m.product_id)}${where(m.bucket)}${m.record_qty !== null && m.record_qty !== m.qty ? ` · record said ${m.record_qty}` : ""}`,
          amount: `= ${m.qty}`,
          tone: "count",
        });
      } else if (m.kind === "delivered" || m.kind === "undelivered") {
        items.push({
          at: m.happened_at,
          text: `${m.kind === "delivered" ? "Delivered" : "Un-marked Delivered"} — ${nameOf(m.product_id)} · ${distNames[m.distributor_id ?? ""] ?? "Distributor"}${m.po_number ? ` PO ${m.po_number}` : ""}`,
          amount: signed(m.qty),
          tone: m.qty < 0 ? "minus" : "plus",
        });
      } else if (m.kind === "other_out" || m.kind === "other_out_undo") {
        items.push({
          at: m.happened_at,
          text: `${m.kind === "other_out" ? "Other out" : "Undo Other out"} — ${nameOf(m.product_id)}${where(m.bucket)} · ${m.reason ?? ""}${m.note ? ` · ${m.note}` : ""}`,
          amount: signed(m.qty),
          tone: m.qty < 0 ? "minus" : "plus",
          move: m.kind === "other_out" ? m : undefined,
        });
      } else if (m.kind === "labeled" && m.bucket === "labeled") {
        items.push({
          at: m.happened_at,
          text: `${m.reverses_id ? "Undo Labeled" : "Labeled"} — ${nameOf(m.product_id)} · Unlabeled → On Hand`,
          amount: signed(m.qty),
          tone: m.qty < 0 ? "minus" : "plus",
          move: m.reverses_id ? undefined : m,
        });
      }
    }
    for (const r of runs) {
      const counted = !!r.product_id && /^completed$/i.test(r.status_title ?? "");
      items.push({
        at: new Date(`${r.packaged_on}T23:00:00-07:00`).toISOString(),
        text: `Packaged in Ekos — ${r.product_id ? nameOf(r.product_id) : r.item_title}${r.unlabeled ? " (Unlabeled)" : ""} · ${r.batch_title ?? ""}${
          r.needs_decision ? " · NOT COUNTED: pick its match on Admin → Ekos Sync" : r.skipped ? " · skipped on the Ekos name list" : !counted ? ` · ${r.status_title ?? ""} — not counted until Completed` : ""
        }`,
        amount: `+${r.units}`,
        tone: r.needs_decision ? "warn" : "plus",
      });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  }, [moves, runs, nameOf, distNames]);

  const waitingOnNames = runs.filter((r) => r.needs_decision).length;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Our Inventory Record {badge.isNew && <NewBadge inline />}
          </h2>
          <p className="text-[11px] text-neutral-500">
            On Hand = last count + packaged in Ekos − delivered orders − other out. It updates by itself; change it with the buttons here.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["count", "Enter count"],
              ["other", "Other out"],
              ["labeled", "Labeled"],
              ["delivered", "Delivered"],
              ["differences", "Count Differences"],
              ["activity", "Activity"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} onClick={() => openTab(t)} className={tab === t ? BTN_ON : BTN}>
              {label}
              {t === "differences" && differences.length > 0 && <span className="ml-1 text-neutral-400">({differences.length})</span>}
            </button>
          ))}
        </div>
      </div>

      {waitingOnNames > 0 && (
        <p className="mt-2 rounded bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-300">
          {waitingOnNames} Ekos packaging run{waitingOnNames === 1 ? "" : "s"} aren&apos;t counted yet — their Ekos item name needs its match picked on Admin → Ekos Sync.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {done && <p className="mt-2 text-xs text-[#6ABC46]">{done}</p>}

      {tab === "count" && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] text-neutral-400">
            Type what you physically counted. Leave a line blank to keep it as is. Each count is saved next to what the record said, so the difference shows under Count Differences.
          </p>
          <div className="mb-2 flex flex-wrap gap-3 text-xs text-neutral-300">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!countAfterPackaging} onChange={() => setCountAfterPackaging(false)} />
              Counted before today&apos;s packaging
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={countAfterPackaging} onChange={() => setCountAfterPackaging(true)} />
              Counted after today&apos;s packaging
            </label>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500">
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-left">Beer</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Record: On Hand</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Counted</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Record: Unlabeled</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Counted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {beerProducts.map((p) => {
                  const lv = levels[p.id];
                  const isCan = derivePackaging(p.name).kind === "can";
                  return (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-1.5 py-1 text-neutral-300">{p.name}</td>
                      <td className="px-1.5 py-1 text-right text-neutral-400">{lv ? lv.on_hand : "—"}</td>
                      <td className="px-1.5 py-1 text-right">
                        <input
                          type="number"
                          min={0}
                          className={`${INPUT} w-16 text-right`}
                          value={countVals[`${p.id}:labeled`] ?? ""}
                          onChange={(e) => setCountVals((prev) => ({ ...prev, [`${p.id}:labeled`]: e.target.value }))}
                        />
                      </td>
                      <td className="px-1.5 py-1 text-right text-neutral-400">{isCan ? (lv ? lv.unlabeled : "—") : ""}</td>
                      <td className="px-1.5 py-1 text-right">
                        {isCan && (
                          <input
                            type="number"
                            min={0}
                            className={`${INPUT} w-16 text-right`}
                            value={countVals[`${p.id}:unlabeled`] ?? ""}
                            onChange={(e) => setCountVals((prev) => ({ ...prev, [`${p.id}:unlabeled`]: e.target.value }))}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button onClick={submitCount} disabled={saving} className={`${BTN} mt-2 disabled:opacity-50`}>
            {saving ? "Saving…" : "Save count"}
          </button>
        </div>
      )}

      {tab === "other" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <select className={INPUT} value={ooProduct} onChange={(e) => setOoProduct(e.target.value)}>
            <option value="">Beer…</option>
            {beerProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className={INPUT} value={ooBucket} onChange={(e) => setOoBucket(e.target.value as Bucket)}>
            <option value="labeled">From On Hand</option>
            <option value="unlabeled">From Unlabeled</option>
          </select>
          <input type="number" min={1} placeholder="Qty" className={`${INPUT} w-16 text-right`} value={ooQty} onChange={(e) => setOoQty(e.target.value)} />
          <select className={INPUT} value={ooReason} onChange={(e) => setOoReason(e.target.value)}>
            <option value="">Reason…</option>
            {OTHER_OUT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input placeholder="Note (optional)" className={`${INPUT} w-48`} value={ooNote} onChange={(e) => setOoNote(e.target.value)} />
          <button onClick={submitOtherOut} disabled={saving} className={`${BTN} disabled:opacity-50`}>
            {saving ? "Saving…" : "Take out"}
          </button>
        </div>
      )}

      {tab === "labeled" && (
        <div className="mt-3 text-xs">
          <p className="mb-2 text-[11px] text-neutral-400">
            Unlabeled cases that got labeled move to On Hand, and their labels and Pak-Techs come off Packaging / Label Inventory now.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select className={INPUT} value={lbProduct} onChange={(e) => setLbProduct(e.target.value)}>
              <option value="">Beer…</option>
              {canProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {levels[p.id] ? `— ${levels[p.id].unlabeled} unlabeled` : ""}
                </option>
              ))}
            </select>
            <input type="number" min={1} placeholder="Cases" className={`${INPUT} w-16 text-right`} value={lbQty} onChange={(e) => setLbQty(e.target.value)} />
            <button onClick={submitLabeled} disabled={saving} className={`${BTN} disabled:opacity-50`}>
              {saving ? "Saving…" : "Mark labeled"}
            </button>
          </div>
          {lbProduct && levels[lbProduct] && Number(lbQty) > levels[lbProduct].unlabeled && (
            <p className="mt-1 text-yellow-300">That&apos;s more than the {levels[lbProduct].unlabeled} unlabeled cases the record shows.</p>
          )}
        </div>
      )}

      {tab === "delivered" && (
        <div className="mt-3 text-xs">
          {delivered.length === 0 ? (
            <p className="text-neutral-500">No orders marked Delivered since the record started (10/26/2026).</p>
          ) : (
            <div className="space-y-2">
              {delivered.map((o) => (
                <div key={o.key} className="rounded border border-neutral-800 p-2">
                  <p className="text-neutral-200">
                    {distNames[o.dist ?? ""] ?? "Distributor"} {o.po ? `· PO ${o.po}` : ""} <span className="text-neutral-500">· {fmtDate(o.at)}</span>
                  </p>
                  <ul className="mt-1 text-neutral-400">
                    {o.lines.map(([pid, q]) => (
                      <li key={pid}>
                        {-q} × {nameOf(pid)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "differences" && (
        <div className="mt-3 text-xs">
          {differences.length === 0 ? (
            <p className="text-neutral-500">No differences yet — every count so far matched the record.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-neutral-500">
                  <th className="px-1.5 py-1 text-left">Counted</th>
                  <th className="px-1.5 py-1 text-left">Beer</th>
                  <th className="px-1.5 py-1 text-right">Record said</th>
                  <th className="px-1.5 py-1 text-right">Counted</th>
                  <th className="px-1.5 py-1 text-right">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {differences.map((m) => {
                  const diff = m.qty - (m.record_qty ?? 0);
                  return (
                    <tr key={m.id}>
                      <td className="px-1.5 py-1 text-neutral-400">{fmtDate(m.happened_at)}</td>
                      <td className="px-1.5 py-1 text-neutral-300">
                        {nameOf(m.product_id)}
                        {m.bucket === "unlabeled" ? " (Unlabeled)" : ""}
                      </td>
                      <td className="px-1.5 py-1 text-right text-neutral-400">{m.record_qty}</td>
                      <td className="px-1.5 py-1 text-right text-neutral-300">{m.qty}</td>
                      <td className={`px-1.5 py-1 text-right font-semibold ${diff < 0 ? "text-red-400" : "text-[#6ABC46]"}`}>{signed(diff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="mt-3 max-h-[420px] overflow-y-auto text-xs">
          {activity.length === 0 ? (
            <p className="text-neutral-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-900">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1">
                  <span className={a.tone === "warn" ? "text-yellow-300" : "text-neutral-300"}>
                    <span className="text-neutral-500">{a.tone === "plus" && a.text.startsWith("Packaged") ? fmtDate(a.at) : fmtDateTime(a.at)}</span> · {a.text}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`font-semibold ${
                        a.tone === "minus" ? "text-red-400" : a.tone === "plus" ? "text-[#6ABC46]" : a.tone === "warn" ? "text-yellow-300" : "text-neutral-200"
                      }`}
                    >
                      {a.amount}
                    </span>
                    {a.move && !undone.has(a.move.id) && (
                      <button onClick={() => a.move && undo(a.move)} disabled={saving} className="text-[11px] text-neutral-500 underline hover:text-neutral-200">
                        Undo
                      </button>
                    )}
                    {a.move && undone.has(a.move.id) && <span className="text-[11px] text-neutral-600">Undone</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
