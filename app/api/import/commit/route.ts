import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";
import { logChange } from "@/lib/audit";

// Commits a previously-previewed VIP/Ekos export: matches each row's
// product name against the products table (case-insensitive, trimmed
// exact match) and upserts distributor_inventory rows. Products that don't
// match anything are returned as "unmatched" so the user knows what to
// clean up (either the file's naming or the product list).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const weekId = formData.get("weekId") as string | null;
  const distributorId = formData.get("distributorId") as string | null;
  const source = formData.get("source") as string | null;
  const productCol = Number(formData.get("productCol"));
  const onHandCol = Number(formData.get("onHandCol"));
  const rateOfSaleCol = Number(formData.get("rateOfSaleCol"));

  if (!file || !weekId || !distributorId || !source) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows } = await parseSpreadsheet(buffer, file.name);

  const { data: products } = await supabase.from("products").select("id,name");
  const productsByName = new Map(
    (products ?? []).map((p) => [p.name.trim().toLowerCase(), p.id as string])
  );

  const unmatched: string[] = [];
  let matchedCount = 0;

  for (const row of rows) {
    const rawName = row[productCol]?.trim();
    if (!rawName) continue;

    const productId = productsByName.get(rawName.toLowerCase());
    if (!productId) {
      unmatched.push(rawName);
      continue;
    }

    const onHandQty = Number(row[onHandCol]?.replace(/[^0-9.-]/g, "")) || 0;
    const rateOfSale = Number(row[rateOfSaleCol]?.replace(/[^0-9.-]/g, "")) || 0;

    const { data: existing } = await supabase
      .from("distributor_inventory")
      .select("*")
      .eq("week_id", weekId)
      .eq("distributor_id", distributorId)
      .eq("product_id", productId)
      .maybeSingle();

    const { data: updated, error } = await supabase
      .from("distributor_inventory")
      .upsert(
        {
          week_id: weekId,
          distributor_id: distributorId,
          product_id: productId,
          on_hand_qty: onHandQty,
          rate_of_sale: rateOfSale,
          source,
          imported_at: new Date().toISOString(),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,distributor_id,product_id" }
      )
      .select()
      .single();

    if (!error && updated) {
      matchedCount += 1;
      await logChange(supabase, {
        weekId,
        tableName: "distributor_inventory",
        recordId: updated.id,
        fieldName: "on_hand_qty",
        oldValue: existing?.on_hand_qty ?? null,
        newValue: onHandQty,
        changedBy: user.id,
      });
      await logChange(supabase, {
        weekId,
        tableName: "distributor_inventory",
        recordId: updated.id,
        fieldName: "rate_of_sale",
        oldValue: existing?.rate_of_sale ?? null,
        newValue: rateOfSale,
        changedBy: user.id,
      });
    }
  }

  return NextResponse.json({ matchedCount, unmatched: Array.from(new Set(unmatched)) });
}
