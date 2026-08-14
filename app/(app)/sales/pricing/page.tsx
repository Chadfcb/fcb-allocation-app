"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type {
  Distributor,
  PricingBrand,
  BrandPriceListRow,
  PriceListPackageKey,
} from "@/lib/types/db";
import { PRICE_LIST_PACKAGE_KEYS, PRICE_LIST_PACKAGE_LABELS } from "@/lib/types/db";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function SalesPricingPage() {
  const supabase = useMemo(() => createClient(), []);

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [brands, setBrands] = useState<PricingBrand[]>([]);
  const [prices, setPrices] = useState<Record<string, BrandPriceListRow>>({}); // key: brandId:packageKey
  const [selectedDistributorId, setSelectedDistributorId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data: distributorData } = await supabase
      .from("distributors")
      .select("*")
      .eq("active", true)
      .order("name");
    setDistributors((distributorData as Distributor[]) ?? []);

    const { data: brandData } = await supabase
      .from("pricing_brands")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setBrands((brandData as PricingBrand[]) ?? []);

    const { data: priceData } = await supabase.from("brand_price_list").select("*");
    const priceMap: Record<string, BrandPriceListRow> = {};
    (priceData as BrandPriceListRow[] | null)?.forEach((row) => {
      priceMap[`${row.brand_id}:${row.package_key}`] = row;
    });
    setPrices(priceMap);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function handlePriceChange(
    brandId: string,
    packageKey: PriceListPackageKey,
    value: number
  ) {
    if (!userId) return;
    const mapKey = `${brandId}:${packageKey}`;
    const key = `price:${mapKey}`;
    setSavingKey(key);

    const existing = prices[mapKey];
    const oldValue = existing?.price ?? 0;
    setPrices((prev) => ({
      ...prev,
      [mapKey]: {
        id: existing?.id ?? "",
        brand_id: brandId,
        package_key: packageKey,
        price: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("brand_price_list")
      .upsert(
        {
          brand_id: brandId,
          package_key: packageKey,
          price: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brand_id,package_key" }
      )
      .select()
      .single();

    if (!error && data) {
      setPrices((prev) => ({ ...prev, [mapKey]: data as BrandPriceListRow }));
      await logChange(supabase, {
        weekId: null,
        tableName: "brand_price_list",
        recordId: data.id,
        fieldName: "price",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  const selectedDistributor = distributors.find((d) => d.id === selectedDistributorId) ?? null;

  return (
    <div className="flex flex-col space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Price List</h1>
        <p className="text-sm text-neutral-400">
          Price to retailer / price to distributor by package size, per brand. Same price list
          for every distributor for now.
        </p>
      </div>

      {!selectedDistributor ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {distributors.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelectedDistributorId(d.id)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-left hover:bg-neutral-900"
            >
              <div className="font-semibold" style={{ color: d.color ?? undefined }}>
                {d.name}
              </div>
              <div className="mt-1 text-xs text-neutral-500">{brands.length} brands</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col space-y-3">
          <div>
            <button
              type="button"
              onClick={() => setSelectedDistributorId(null)}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
            >
              ← Back to distributors
            </button>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="sticky top-0 left-0 z-20 h-8 whitespace-nowrap bg-neutral-900 px-3 text-left">
                    Brand
                  </th>
                  {PRICE_LIST_PACKAGE_KEYS.map((k) => (
                    <th
                      key={k}
                      className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right"
                    >
                      {PRICE_LIST_PACKAGE_LABELS[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {brands.map((b) => (
                  <tr key={b.id} className="group hover:bg-neutral-900/60">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                      {b.name}
                    </td>
                    {PRICE_LIST_PACKAGE_KEYS.map((k) => {
                      const price = prices[`${b.id}:${k}`]?.price ?? 0;
                      return (
                        <td key={k} className="px-2 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <span className="text-neutral-500">$</span>
                            <input
                              type="number"
                              step="0.01"
                              className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                              value={price}
                              onChange={(e) =>
                                handlePriceChange(b.id, k, Number(e.target.value) || 0)
                              }
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-neutral-500">
            {savingKey
              ? "Saving…"
              : `${currencyFormatter.format(0)} shown means no price has been set yet for that package size.`}
          </p>
        </div>
      )}
    </div>
  );
}
