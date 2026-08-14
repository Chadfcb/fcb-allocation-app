"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type {
  PricingBrand,
  MarginAnalysis,
  MarginAnalysisPackage,
  PriceListPackageKey,
} from "@/lib/types/db";
import { PRICE_LIST_PACKAGE_KEYS } from "@/lib/types/db";
import {
  PKG_META,
  CAN_KEYS,
  KEG_KEYS,
  calcPkg,
  calcBatchCan,
  calcBatchKeg,
  fmtDollar,
  fmtRounded,
  fmtPct,
} from "@/lib/marginAnalysis";

// One package row's editable fields while creating/editing an analysis.
interface PackageDraft {
  enabled: boolean;
  ptr: string; // kept as text while editing, parsed on save/preview
  ptd: string;
  packCost: string;
  labor: string;
  yieldAmt: string;
}

interface AnalysisDraft {
  batchCost: string;
  yieldBbls: string;
  packages: Record<PriceListPackageKey, PackageDraft>;
}

function emptyPackageDraft(key: PriceListPackageKey): PackageDraft {
  const m = PKG_META[key];
  return {
    enabled: !m.isKeg,
    ptr: "",
    ptd: "",
    packCost: "",
    labor: "",
    yieldAmt: "",
  };
}

function emptyDraft(): AnalysisDraft {
  const packages = {} as Record<PriceListPackageKey, PackageDraft>;
  PRICE_LIST_PACKAGE_KEYS.forEach((k) => {
    packages[k] = emptyPackageDraft(k);
  });
  return { batchCost: "", yieldBbls: "30", packages };
}

function draftFromExisting(
  analysis: MarginAnalysis,
  packages: Record<PriceListPackageKey, MarginAnalysisPackage>
): AnalysisDraft {
  const pkgDraft = {} as Record<PriceListPackageKey, PackageDraft>;
  PRICE_LIST_PACKAGE_KEYS.forEach((k) => {
    const p = packages[k];
    pkgDraft[k] = {
      enabled: p?.enabled ?? !PKG_META[k].isKeg,
      ptr: p?.ptr != null ? String(p.ptr) : "",
      ptd: p?.ptd != null ? String(p.ptd) : "",
      packCost: p?.pack_cost != null ? String(p.pack_cost) : "",
      labor: p?.labor != null ? String(p.labor) : "",
      yieldAmt: p?.yield_amt != null ? String(p.yield_amt) : "",
    };
  });
  return {
    batchCost: String(analysis.batch_cost ?? ""),
    yieldBbls: String(analysis.yield_bbls ?? "30"),
    packages: pkgDraft,
  };
}

function num(s: string): number {
  return parseFloat(s) || 0;
}

// Computes the batch-economics preview for one package row of a draft —
// used both while editing (live preview) and isn't needed after save since
// the detail view reads straight from the database.
function previewFor(pkg: PackageDraft, key: PriceListPackageKey, batchCostStr: string) {
  const m = PKG_META[key];
  const ptr = num(pkg.ptr);
  const ptd = num(pkg.ptd);
  if (!ptr || !ptd) return null;
  const calc = calcPkg(ptr, ptd, m.units);
  if (!calc) return null;
  const batchCost = num(batchCostStr);
  const labor = pkg.labor ? num(pkg.labor) : m.labor;
  const yieldAmt = pkg.yieldAmt ? num(pkg.yieldAmt) : m.defaultYield;
  if (m.isKeg) {
    return calcBatchKeg(calc.ptd, yieldAmt, batchCost, labor);
  }
  const packCost = pkg.packCost ? num(pkg.packCost) : m.packCost;
  return calcBatchCan(calc.ptd, yieldAmt, batchCost, packCost, labor);
}

export default function MarginAnalysisPage() {
  const supabase = useMemo(() => createClient(), []);

  const [brands, setBrands] = useState<PricingBrand[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, MarginAnalysis>>({}); // key: brand_id
  const [packagesByAnalysis, setPackagesByAnalysis] = useState<
    Record<string, Record<PriceListPackageKey, MarginAnalysisPackage>>
  >({});
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "detail" | "form">("list");
  const [selectedPackageKey, setSelectedPackageKey] = useState<PriceListPackageKey | null>(null);
  const [draft, setDraft] = useState<AnalysisDraft | null>(null);

  const [newBrandName, setNewBrandName] = useState("");
  const [addingBrand, setAddingBrand] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data: brandData } = await supabase
      .from("pricing_brands")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setBrands((brandData as PricingBrand[]) ?? []);

    const { data: analysisData } = await supabase.from("margin_analyses").select("*");
    const analysisMap: Record<string, MarginAnalysis> = {};
    (analysisData as MarginAnalysis[] | null)?.forEach((a) => {
      analysisMap[a.brand_id] = a;
    });
    setAnalyses(analysisMap);

    const { data: packageData } = await supabase.from("margin_analysis_packages").select("*");
    const pkgMap: Record<string, Record<PriceListPackageKey, MarginAnalysisPackage>> = {};
    (packageData as MarginAnalysisPackage[] | null)?.forEach((p) => {
      if (!pkgMap[p.analysis_id]) pkgMap[p.analysis_id] = {} as Record<
        PriceListPackageKey,
        MarginAnalysisPackage
      >;
      pkgMap[p.analysis_id][p.package_key] = p;
    });
    setPackagesByAnalysis(pkgMap);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function handleAddBrand(e: React.FormEvent) {
    e.preventDefault();
    const name = newBrandName.trim();
    if (!name) return;
    setAddingBrand(true);

    const nextSortOrder = brands.reduce((max, b) => Math.max(max, b.sort_order ?? 0), 0) + 1;
    const { error } = await supabase
      .from("pricing_brands")
      .insert({ name, sort_order: nextSortOrder });

    if (!error) {
      setNewBrandName("");
      await load();
    }
    setAddingBrand(false);
  }

  function openBrand(brandId: string) {
    setSelectedBrandId(brandId);
    setSelectedPackageKey(null);
    const analysis = analyses[brandId];
    if (analysis) {
      setMode("detail");
    } else {
      setDraft(emptyDraft());
      setMode("form");
    }
  }

  function backToList() {
    setSelectedBrandId(null);
    setMode("list");
    setDraft(null);
  }

  function startEdit() {
    if (!selectedBrandId) return;
    const analysis = analyses[selectedBrandId];
    if (analysis) {
      const existingPackages =
        packagesByAnalysis[analysis.id] ??
        ({} as Record<PriceListPackageKey, MarginAnalysisPackage>);
      setDraft(draftFromExisting(analysis, existingPackages));
    } else {
      setDraft(emptyDraft());
    }
    setMode("form");
  }

  function cancelForm() {
    if (analyses[selectedBrandId ?? ""]) {
      setMode("detail");
    } else {
      backToList();
    }
    setDraft(null);
  }

  async function handleSave() {
    if (!selectedBrandId || !draft || !userId) return;
    setSaving(true);

    const existing = analyses[selectedBrandId];

    const { data: analysisRow, error: analysisError } = await supabase
      .from("margin_analyses")
      .upsert(
        {
          id: existing?.id,
          brand_id: selectedBrandId,
          batch_cost: num(draft.batchCost),
          yield_bbls: num(draft.yieldBbls) || 30,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brand_id" }
      )
      .select()
      .single();

    if (analysisError || !analysisRow) {
      setSaving(false);
      return;
    }

    const analysisId = (analysisRow as MarginAnalysis).id;

    for (const key of PRICE_LIST_PACKAGE_KEYS) {
      const pkg = draft.packages[key];
      await supabase.from("margin_analysis_packages").upsert(
        {
          analysis_id: analysisId,
          package_key: key,
          enabled: pkg.enabled,
          ptr: pkg.ptr ? num(pkg.ptr) : null,
          ptd: pkg.ptd ? num(pkg.ptd) : null,
          pack_cost: pkg.packCost ? num(pkg.packCost) : null,
          labor: pkg.labor ? num(pkg.labor) : null,
          yield_amt: pkg.yieldAmt ? num(pkg.yieldAmt) : null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "analysis_id,package_key" }
      );
    }

    await logChange(supabase, {
      weekId: null,
      tableName: "margin_analyses",
      recordId: analysisId,
      fieldName: "batch_cost",
      oldValue: existing?.batch_cost ?? null,
      newValue: num(draft.batchCost),
      changedBy: userId,
    });

    await load();
    setSaving(false);
    setMode("detail");
    setDraft(null);
  }

  async function handleDelete() {
    if (!selectedBrandId) return;
    const existing = analyses[selectedBrandId];
    if (!existing) return;
    const brand = brands.find((b) => b.id === selectedBrandId);
    if (!window.confirm(`Delete the Margin Analysis for ${brand?.name ?? "this brand"}?`)) return;

    await supabase.from("margin_analyses").delete().eq("id", existing.id);
    backToList();
    await load();
  }

  function updatePackageDraft(
    key: PriceListPackageKey,
    field: keyof PackageDraft,
    value: string | boolean
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        packages: {
          ...prev.packages,
          [key]: { ...prev.packages[key], [field]: value },
        },
      };
    });
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? null;
  const selectedAnalysis = selectedBrandId ? analyses[selectedBrandId] : undefined;
  const selectedPackages: Record<PriceListPackageKey, MarginAnalysisPackage | undefined> =
    (selectedAnalysis ? packagesByAnalysis[selectedAnalysis.id] : undefined) ?? ({} as Record<PriceListPackageKey, MarginAnalysisPackage | undefined>);

  return (
    <div className="flex flex-col space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Margin Analysis</h1>
        <p className="text-sm text-neutral-400">
          Batch cost and price-to-retailer / price-to-distributor by package size, per brand —
          shows gross profit and full batch economics.
        </p>
      </div>

      {mode === "list" && (
        <div className="flex flex-col space-y-3">
          <form
            onSubmit={handleAddBrand}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Add a brand
              </label>
              <input
                type="text"
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="Brand name"
                className="w-64 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={addingBrand || !newBrandName.trim()}
              className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
            >
              {addingBrand ? "Adding…" : "Add Brand"}
            </button>
          </form>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((b) => {
              const analysis = analyses[b.id];
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => openBrand(b.id)}
                  className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-left hover:bg-neutral-900"
                >
                  <div className="font-semibold text-neutral-100">{b.name}</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {analysis
                      ? `Updated ${new Date(analysis.updated_at).toLocaleDateString()}`
                      : "No analysis yet — click to create"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mode === "detail" && selectedBrand && selectedAnalysis && (
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={backToList}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
            >
              ← Back to brands
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startEdit}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-md border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
              >
                Delete
              </button>
            </div>
          </div>

          <div>
            <div className="text-base font-semibold text-neutral-100">{selectedBrand.name}</div>
            <div className="text-xs text-neutral-500">
              Updated {new Date(selectedAnalysis.updated_at).toLocaleDateString()} ·{" "}
              {selectedAnalysis.yield_bbls} BBL batch
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="whitespace-nowrap bg-neutral-900 px-3 py-1 text-left">Package</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">PTR</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">PTD</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">
                    Tax/28%
                  </th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">GP $</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">GP %</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">
                    Unit Price
                  </th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">@15%</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">@20%</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">@25%</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">@30%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {PRICE_LIST_PACKAGE_KEYS.map((k) => {
                  const m = PKG_META[k];
                  const p = selectedPackages[k];
                  const ptr = p?.ptr ?? 0;
                  const ptd = p?.ptd ?? 0;
                  const calc = ptr > 0 && ptd > 0 ? calcPkg(ptr, ptd, m.units) : null;
                  const disabled = !p?.enabled || !ptr;
                  return (
                    <tr
                      key={k}
                      onClick={() => setSelectedPackageKey(k)}
                      className={`cursor-pointer hover:bg-neutral-900/60 ${
                        disabled ? "text-neutral-600" : "text-neutral-200"
                      } ${selectedPackageKey === k ? "bg-neutral-900/80" : ""}`}
                    >
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{m.label}</span>{" "}
                        <span className="text-xs text-neutral-500">
                          {m.units} × {m.vol}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">{ptr > 0 ? fmtDollar(ptr) : "—"}</td>
                      <td className="px-2 py-1.5 text-right">{ptd > 0 ? fmtDollar(ptd) : "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtDollar(calc.tax28) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtDollar(calc["gp$"]) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtPct(calc.gp_pct) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtDollar(calc.uPrice) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtDollar(calc.ptc15) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtDollar(calc.ptc20) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtDollar(calc.ptc25) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {calc ? fmtDollar(calc.ptc30) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-neutral-500">Click a package row to see batch economics.</p>

          {selectedPackageKey &&
            (() => {
              const k = selectedPackageKey;
              const m = PKG_META[k];
              const p = selectedPackages[k];
              const ptr = p?.ptr ?? 0;
              const ptd = p?.ptd ?? 0;
              const batchCost = selectedAnalysis.batch_cost ?? 0;
              if (!ptr || !ptd || !batchCost) {
                return (
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-500">
                    Set PTR, PTD, and Batch Cost to view batch economics for {m.label}.
                  </div>
                );
              }
              const calc = calcPkg(ptr, ptd, m.units);
              const labor = p?.labor ?? m.labor;
              const yieldAmt = p?.yield_amt ?? m.defaultYield;
              const packCost = p?.pack_cost ?? m.packCost;
              const bc = calc
                ? m.isKeg
                  ? calcBatchKeg(calc.ptd, yieldAmt, batchCost, labor)
                  : calcBatchCan(calc.ptd, yieldAmt, batchCost, packCost, labor)
                : null;
              if (!bc) return null;
              const profitPositive = bc.profit >= 0;
              return (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold text-neutral-100">
                      Batch Economics — {m.label} {m.vol}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedPackageKey(null)}
                      className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
                    >
                      Close
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-neutral-500">Yield</span>
                      <span className="text-neutral-200">
                        {yieldAmt} {m.isKeg ? "kegs" : "cases"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-neutral-500">Revenue (PTD × yield)</span>
                      <span className="text-neutral-200">{fmtRounded(bc.revenue)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-neutral-500">Batch Cost</span>
                      <span className="text-neutral-200">{fmtRounded(batchCost)}</span>
                    </div>
                    {!m.isKeg && (
                      <div className="flex justify-between gap-3">
                        <span className="text-neutral-500">Packaging</span>
                        <span className="text-neutral-200">{fmtRounded(packCost)}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <span className="text-neutral-500">Labor</span>
                      <span className="text-neutral-200">{fmtRounded(labor)}</span>
                    </div>
                    <div className="flex justify-between gap-3 font-semibold">
                      <span className="text-neutral-400">Total Cost</span>
                      <span className="text-neutral-100">{fmtRounded(bc.total)}</span>
                    </div>
                    <div
                      className={`flex justify-between gap-3 font-semibold ${
                        profitPositive ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      <span>Profit</span>
                      <span>{fmtRounded(bc.profit)}</span>
                    </div>
                    <div
                      className={`flex justify-between gap-3 font-semibold ${
                        profitPositive ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      <span>Margin</span>
                      <span>{fmtPct(bc.margin)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>
      )}

      {mode === "form" && draft && selectedBrand && (
        <div className="flex flex-col space-y-4">
          <div>
            <button
              type="button"
              onClick={cancelForm}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
          </div>

          <div className="text-base font-semibold text-neutral-100">
            {selectedAnalysis ? "Edit" : "New"} Margin Analysis — {selectedBrand.name}
          </div>

          <div className="flex flex-wrap gap-6 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Batch Cost $
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft.batchCost}
                onChange={(e) => setDraft((p) => (p ? { ...p, batchCost: e.target.value } : p))}
                placeholder="0.00"
                className="w-40 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Yield (BBLs)
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={draft.yieldBbls}
                onChange={(e) => setDraft((p) => (p ? { ...p, yieldBbls: e.target.value } : p))}
                placeholder="30"
                className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="text-sm font-semibold text-neutral-300">
            Package Pricing — enter PTR to calculate
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="whitespace-nowrap bg-neutral-900 px-3 py-1 text-left">Package</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">PTR</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">PTD</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">
                    Tax/28%
                  </th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">GP $</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">GP %</th>
                  <th className="whitespace-nowrap bg-neutral-900 px-2 py-1 text-right">
                    Unit Price
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {PRICE_LIST_PACKAGE_KEYS.map((k) => {
                  const m = PKG_META[k];
                  const pkg = draft.packages[k];
                  const ptr = num(pkg.ptr);
                  const ptd = num(pkg.ptd);
                  const calc = ptr > 0 && ptd > 0 ? calcPkg(ptr, ptd, m.units) : null;
                  return (
                    <tr key={k} className={!pkg.enabled ? "opacity-50" : ""}>
                      <td className="px-3 py-1.5">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={pkg.enabled}
                            onChange={(e) => updatePackageDraft(k, "enabled", e.target.checked)}
                          />
                          <span className="font-medium text-neutral-200">{m.label}</span>
                        </label>
                        <span className="ml-6 text-xs text-neutral-500">
                          {m.units} × {m.vol}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={pkg.ptr}
                          onChange={(e) => updatePackageDraft(k, "ptr", e.target.value)}
                          placeholder="0.00"
                          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={pkg.ptd}
                          onChange={(e) => updatePackageDraft(k, "ptd", e.target.value)}
                          placeholder="0.00"
                          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right text-neutral-400">
                        {calc ? fmtDollar(calc.tax28) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-neutral-400">
                        {calc ? fmtDollar(calc["gp$"]) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-neutral-400">
                        {calc ? fmtPct(calc.gp_pct) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-neutral-400">
                        {calc ? fmtDollar(calc.uPrice) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-sm font-semibold text-neutral-300">Cans</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CAN_KEYS.map((k) => (
              <BatchFormCard
                key={k}
                packageKey={k}
                pkg={draft.packages[k]}
                batchCost={draft.batchCost}
                onChange={(field, value) => updatePackageDraft(k, field, value)}
              />
            ))}
          </div>

          <div className="text-sm font-semibold text-neutral-300">Kegs</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {KEG_KEYS.map((k) => (
              <BatchFormCard
                key={k}
                packageKey={k}
                pkg={draft.packages[k]}
                batchCost={draft.batchCost}
                onChange={(field, value) => updatePackageDraft(k, field, value)}
              />
            ))}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={cancelForm}
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Analysis"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BatchFormCard({
  packageKey,
  pkg,
  batchCost,
  onChange,
}: {
  packageKey: PriceListPackageKey;
  pkg: PackageDraft;
  batchCost: string;
  onChange: (field: keyof PackageDraft, value: string) => void;
}) {
  const m = PKG_META[packageKey];
  const bc = previewFor(pkg, packageKey, batchCost);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-2 text-sm font-semibold text-neutral-200">
        {m.label} {m.vol}
      </div>
      {!m.isKeg && (
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-neutral-500">Packaging Cost $</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={pkg.packCost}
            onChange={(e) => onChange("packCost", e.target.value)}
            placeholder={m.packCost.toFixed(2)}
            className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
          />
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-500">Labor $</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={pkg.labor}
          onChange={(e) => onChange("labor", e.target.value)}
          placeholder={m.labor.toFixed(2)}
          className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
        />
      </div>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-500">Yield ({m.isKeg ? "kegs" : "cases"})</span>
        <input
          type="number"
          step="1"
          min="1"
          value={pkg.yieldAmt}
          onChange={(e) => onChange("yieldAmt", e.target.value)}
          placeholder={String(m.defaultYield)}
          className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
        />
      </div>
      <hr className="my-2 border-neutral-800" />
      {!bc ? (
        <p className="text-xs italic text-neutral-600">Set PTR + Batch Cost to preview</p>
      ) : (
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-neutral-500">Revenue</span>
            <span className="text-neutral-200">{fmtRounded(bc.revenue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Total Cost</span>
            <span className="text-neutral-200">{fmtRounded(bc.total)}</span>
          </div>
          <div
            className={`flex justify-between font-semibold ${
              bc.profit >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            <span>Profit {fmtRounded(bc.profit)}</span>
            <span>{fmtPct(bc.margin)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
