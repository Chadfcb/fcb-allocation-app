"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { Product, Distributor, SectionDivider, DistributorPrice } from "@/lib/types/db";

// Product/divider ordering mirrors the Inventory & Allocation and
// Distributor Data pages, so the product list here matches everywhere else.
type CombinedRow =
  | { kind: "product"; item: Product }
  | { kind: "divider"; item: SectionDivider };

function rowSortOrder(row: CombinedRow): number {
  if (row.kind === "divider") return row.item.sort_order;
  return row.item.sort_order ?? Number.MAX_SAFE_INTEGER;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function PricingPage() {
  const supabase = useMemo(() => createClient(), []);

  const [products, setProducts] = useState<Product[]>([]);
  const [dividers, setDividers] = useState<SectionDivider[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [prices, setPrices] = useState<Record<string, DistributorPrice>>({}); // key: productId:distributorId
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAdmin(profile?.role === "admin");
    }

    // Same product list, order, and brand dividers as the Inventory &
    // Allocation grid and the Distributor Data page.
    const { data: productData } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setProducts((productData as Product[]) ?? []);

    const { data: dividerData } = await supabase.from("section_dividers").select("*");
    setDividers((dividerData as SectionDivider[]) ?? []);

    const { data: distributorData } = await supabase
      .from("distributors")
      .select("*")
      .eq("active", true)
      .order("name");
    setDistributors((distributorData as Distributor[]) ?? []);

    const { data: priceData } = await supabase.from("distributor_prices").select("*");
    const priceMap: Record<string, DistributorPrice> = {};
    (priceData as DistributorPrice[] | null)?.forEach((row) => {
      priceMap[`${row.product_id}:${row.distributor_id}`] = row;
    });
    setPrices(priceMap);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function handlePriceChange(productId: string, distributorId: string, value: number) {
    if (!userId) return;
    const mapKey = `${productId}:${distributorId}`;
    const key = `price:${mapKey}`;
    setSavingKey(key);

    const existing = prices[mapKey];
    const oldValue = existing?.price ?? 0;
    setPrices((prev) => ({
      ...prev,
      [mapKey]: {
        id: existing?.id ?? "",
        distributor_id: distributorId,
        product_id: productId,
        price: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("distributor_prices")
      .upsert(
        {
          distributor_id: distributorId,
          product_id: productId,
          price: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "distributor_id,product_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setPrices((prev) => ({ ...prev, [mapKey]: data as DistributorPrice }));
      await logChange(supabase, {
        weekId: null,
        tableName: "distributor_prices",
        recordId: data.id,
        fieldName: "price",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  const combined: CombinedRow[] = [
    ...products.map((p): CombinedRow => ({ kind: "product", item: p })),
    ...dividers.map((d): CombinedRow => ({ kind: "divider", item: d })),
  ].sort((a, b) => rowSortOrder(a) - rowSortOrder(b));

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  if (!isAdmin) {
    return (
      <p className="text-sm text-neutral-400">
        Distributor Pricing is only available to admins.
      </p>
    );
  }

  return (
    <div className="flex flex-col space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Distributor Pricing</h1>
        <p className="text-sm text-neutral-400">
          Each distributor&apos;s own price per item — not an average. These drive the Order
          Value totals on the Inventory &amp; Allocation page.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
              <th className="sticky top-0 left-0 z-20 h-8 whitespace-nowrap bg-neutral-900 px-3 text-left">
                Product
              </th>
              {distributors.map((d) => (
                <th
                  key={d.id}
                  className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right"
                  style={{ color: d.color ?? undefined }}
                >
                  {d.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {combined.map((row) => {
              if (row.kind === "divider") {
                return (
                  <tr key={`divider:${row.item.id}`} className="bg-neutral-900/70">
                    <td
                      colSpan={1 + distributors.length}
                      className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-300"
                    >
                      {row.item.label}
                    </td>
                  </tr>
                );
              }

              const p = row.item;
              return (
                <tr key={p.id} className="group hover:bg-neutral-900/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                    {p.name}
                  </td>
                  {distributors.map((d) => {
                    const price = prices[`${p.id}:${d.id}`]?.price ?? 0;
                    return (
                      <td key={d.id} className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-neutral-500">$</span>
                          <input
                            type="number"
                            step="0.01"
                            className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                            value={price}
                            onChange={(e) =>
                              handlePriceChange(p.id, d.id, Number(e.target.value) || 0)
                            }
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        {savingKey ? "Saving…" : `${currencyFormatter.format(0)} shown means no price has been set yet for that distributor/product.`}
      </p>
    </div>
  );
}
