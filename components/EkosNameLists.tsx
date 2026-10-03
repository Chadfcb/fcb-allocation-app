"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Admin → Ekos Sync → "Ekos name lists" (added 2026-10-03). How each name
// Ekos shows maps to the app — table ekos_name_map (sql/ekos_name_map.sql).
// Replaces editing claude/ekos-sync-reference.md in a chat: when Ekos shows
// something new (e.g. a new beer, or Superior once it's in VIP), the
// automatic sync leaves it out and lists it here under "Needs a decision";
// pick the app match or Skip and the next sync picks it up.

type Kind = "distributor" | "item";

interface MapRow {
  kind: Kind;
  ekos_name: string;
  app_name: string | null;
  skip: boolean;
  first_seen_at: string;
}

const SKIP = "__skip__";

export default function EkosNameLists() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<MapRow[]>([]);
  const [coreNames, setCoreNames] = useState<string[]>([]);
  const [productNames, setProductNames] = useState<string[]>([]);
  const [tab, setTab] = useState<Kind>("item");
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newChoice, setNewChoice] = useState("");

  const load = useCallback(async () => {
    const [{ data: map, error: mapErr }, { data: dists }, { data: prods }] = await Promise.all([
      supabase.from("ekos_name_map").select("kind, ekos_name, app_name, skip, first_seen_at").order("ekos_name"),
      supabase.from("distributors").select("name").eq("is_core_distributor", true).order("name"),
      supabase.from("products").select("name").eq("active", true).order("name"),
    ]);
    if (mapErr) setError("Couldn't load the Ekos name lists — has sql/ekos_name_map.sql been run in Supabase?");
    setRows((map as MapRow[] | null) ?? []);
    setCoreNames(((dists as { name: string }[] | null) ?? []).map((d) => d.name));
    setProductNames(((prods as { name: string }[] | null) ?? []).map((p) => p.name));
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  const choices = tab === "distributor" ? coreNames : productNames;
  const pending = rows.filter((r) => !r.skip && !r.app_name);
  const list = rows.filter((r) => r.kind === tab && (r.skip || r.app_name));

  async function save(kind: Kind, ekosName: string, choice: string) {
    if (!choice) return;
    setError(null);
    setSavingKey(`${kind}|${ekosName}`);
    const { data: auth } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("ekos_name_map").upsert(
      {
        kind,
        ekos_name: ekosName,
        app_name: choice === SKIP ? null : choice,
        skip: choice === SKIP,
        updated_at: new Date().toISOString(),
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: "kind,ekos_name" },
    );
    setSavingKey(null);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function remove(kind: Kind, ekosName: string) {
    setError(null);
    const { error: err } = await supabase.from("ekos_name_map").delete().eq("kind", kind).eq("ekos_name", ekosName);
    if (err) setError(err.message);
    await load();
  }

  async function addNew() {
    // Keep Ekos's exact spelling (double spaces etc.) — only trim the ends.
    const name = newName.replace(/^\s+|\s+$/g, "");
    if (!name || !newChoice) return;
    await save(tab, name, newChoice);
    setNewName("");
    setNewChoice("");
  }

  const choiceOptions = (kind: Kind) => (
    <>
      <option value="">Pick a match…</option>
      {(kind === "distributor" ? coreNames : productNames).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value={SKIP}>Skip — don&apos;t sync this</option>
    </>
  );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Ekos name lists</h2>
      <p className="max-w-2xl text-xs text-neutral-500">
        How each name in Ekos matches the app. Distributors can only match the Core distributors. Names must match
        Ekos exactly, typos included. Anything not on these lists is never guessed — it shows up under
        &ldquo;Needs a decision&rdquo; instead.
      </p>
      {error && <p className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}

      {pending.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-800 bg-amber-950/30 p-3">
          <p className="text-sm font-medium text-amber-300">Needs a decision ({pending.length})</p>
          {pending.map((r) => (
            <div key={`${r.kind}|${r.ekos_name}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                {r.kind === "distributor" ? "Distributor" : "Item"}
              </span>
              <span className="whitespace-pre-wrap break-words text-neutral-100">{r.ekos_name}</span>
              <span className="text-neutral-500">→</span>
              <select
                defaultValue=""
                disabled={savingKey === `${r.kind}|${r.ekos_name}`}
                onChange={(e) => save(r.kind, r.ekos_name, e.target.value)}
                className="max-w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
              >
                {choiceOptions(r.kind)}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1">
        {(["item", "distributor"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              tab === k ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {k === "item" ? "Items" : "Distributors"}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Ekos name</th>
              <th className="px-3 py-2 font-medium">Syncs as</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={`${r.kind}|${r.ekos_name}`} className="border-t border-neutral-800">
                <td className="whitespace-pre-wrap break-words px-3 py-2 text-neutral-200">{r.ekos_name}</td>
                <td className="px-3 py-2">
                  <select
                    value={r.skip ? SKIP : (r.app_name ?? "")}
                    disabled={savingKey === `${r.kind}|${r.ekos_name}`}
                    onChange={(e) => save(r.kind, r.ekos_name, e.target.value)}
                    className={`max-w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm ${
                      r.skip ? "text-neutral-500" : "text-neutral-100"
                    }`}
                  >
                    {r.app_name && !choices.includes(r.app_name) && (
                      <option value={r.app_name}>{r.app_name} (not found in the app)</option>
                    )}
                    {choiceOptions(r.kind)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    title="Remove from the list"
                    onClick={() => remove(r.kind, r.ekos_name)}
                    className="text-neutral-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-neutral-800 bg-neutral-950">
              <td className="px-3 py-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={tab === "item" ? "Add an Ekos item name…" : "Add an Ekos distributor name…"}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                />
              </td>
              <td className="px-3 py-2">
                <select
                  value={newChoice}
                  onChange={(e) => setNewChoice(e.target.value)}
                  className="max-w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                >
                  {choiceOptions(tab)}
                </select>
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={addNew}
                  disabled={!newName.trim() || !newChoice}
                  className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-on-brand disabled:opacity-40"
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
