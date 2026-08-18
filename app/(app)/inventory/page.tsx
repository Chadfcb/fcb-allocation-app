"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { logChange } from "@/lib/audit";
import type {
  Week,
  Product,
  Distributor,
  InventoryWithRemaining,
  Allocation,
  DistributorPO,
  StatusFlag,
  SectionDivider,
  PackagingInventoryRow,
  LabelInventoryRow,
  CustomPackagingItem,
  CustomPackagingInventoryRow,
  CustomLabelItem,
  CustomLabelInventoryRow,
  DistributorPrice,
  PoStatus,
} from "@/lib/types/db";
import { STATUS_FLAG_LABELS, STATUS_FLAG_COLORS, PO_STATUS_LABELS, PO_STATUS_COLORS } from "@/lib/types/db";
import { PACKAGING_ITEMS, derivePackaging, computeConsumption } from "@/lib/packaging";

type InventoryEditableField = "on_hand" | "unlabeled" | "to_be_packaged";

type AllocationCell = {
  id: string;
  quantity: number;
  status_flag: StatusFlag;
};

type CombinedRow =
  | { kind: "product"; item: Product }
  | { kind: "divider"; item: SectionDivider };

function rowKey(row: CombinedRow): string {
  return row.kind === "product" ? `product:${row.item.id}` : `divider:${row.item.id}`;
}

function rowSortOrder(row: CombinedRow): number {
  if (row.kind === "divider") return row.item.sort_order;
  return row.item.sort_order ?? Number.MAX_SAFE_INTEGER;
}

function rowLabel(row: CombinedRow): string {
  return row.kind === "product" ? row.item.name : `— ${row.item.label} —`;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Click-to-pick swatches for the "Add distributor column" color field —
// nobody should have to know a hex code. The first 7 are the colors
// already in use by the current distributors (so it's obvious what's
// taken); the rest are additional distinguishable options for new ones.
const DISTRIBUTOR_COLOR_SWATCHES: { hex: string; label: string }[] = [
  { hex: "#3fb950", label: "Green (Matagrano)" },
  { hex: "#d4a017", label: "Gold (Saccani)" },
  { hex: "#388bfd", label: "Blue (Valleywide)" },
  { hex: "#bc8cff", label: "Purple (Guardian)" },
  { hex: "#00b4d8", label: "Cyan (Markstein)" },
  { hex: "#f85149", label: "Red (Coast)" },
  { hex: "#ff7b54", label: "Orange (Superior)" },
  { hex: "#e56399", label: "Pink" },
  { hex: "#9ccc3f", label: "Lime" },
  { hex: "#8a94a6", label: "Slate" },
  { hex: "#c98d4a", label: "Brown" },
  { hex: "#e6e6e6", label: "Light gray" },
];

// The single Edit menu's five scopes — only one is ever active at a time.
// Selecting one highlights (in yellow) and enables just that area's
// add/rename/remove/reorder controls; everything else stays in its normal,
// locked-down view.
type EditMode = "distributors" | "items" | "dividers" | "packaging" | "labels";

const EDIT_MODE_OPTIONS: { key: EditMode; label: string }[] = [
  { key: "distributors", label: "Edit Distributors" },
  { key: "items", label: "Edit Items" },
  { key: "dividers", label: "Edit Dividers" },
  { key: "packaging", label: "Edit Packaging Inventory Item" },
  { key: "labels", label: "Edit Label Item" },
];

// Shared styling so every editable control (✕ remove, ◀▶/▲▼ reorder, rename
// fields, add-new forms) gets the same yellow "you're editing this" look
// while its mode is active.
const EDIT_ICON_BTN =
  "rounded border border-yellow-500/70 bg-yellow-500/10 px-1 text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-30 disabled:border-neutral-700 disabled:bg-transparent disabled:text-neutral-600";
const EDIT_INPUT =
  "rounded border border-yellow-500/70 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-yellow-400 focus:outline-none";
const EDIT_PANEL = "rounded-lg border border-yellow-500/40 bg-yellow-500/[0.03] p-3";

// Generic "insert after" positioning shared by every flat, reorderable
// admin list on this page (distributors, custom packaging items, custom
// label items) — finds a sort_order value that lands a row at a specific
// spot without renumbering anything else.
function computeFlatInsertSortOrder<T extends { id: string; sort_order: number | null }>(
  list: T[],
  afterKey: string
): number {
  const order = (x: T) => x.sort_order ?? Number.MAX_SAFE_INTEGER;
  const maxOrder = list.reduce((max, x) => Math.max(max, order(x)), 0);
  if (afterKey === "__end__") return maxOrder + 1;
  if (afterKey === "__start__") {
    const minOrder = list.reduce((min, x) => Math.min(min, order(x)), maxOrder);
    return minOrder - 1;
  }
  const idx = list.findIndex((x) => x.id === afterKey);
  if (idx === -1) return maxOrder + 1;
  const anchor = order(list[idx]);
  const next = idx + 1 < list.length ? order(list[idx + 1]) : anchor + 1;
  return (anchor + next) / 2;
}

// ---------------------------------------------------------------------
// Live sync helpers — used by the Realtime subscriptions set up inside the
// page component below. Kept at module scope since none of them close over
// component state; each helper mirrors this file's existing local-update
// conventions (archive = active:false removes the row from the on-screen
// list; a plain rename/quantity change just patches that one row; products
// and dividers don't need re-sorting here since `combined` in the
// component always re-sorts them at render time) so a change from someone
// else's browser ends up looking exactly like the same change made
// locally.
// ---------------------------------------------------------------------

function sortFlatList<T extends { sort_order: number | null; name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

// For lists that use the "active: false" archive pattern instead of a real
// delete (distributors, custom packaging/label items) — insert, update, or
// drop a just-archived row, keeping the list sorted the same way the local
// add/move handlers already do.
function applyArchivableListChange<
  T extends { id: string; sort_order: number | null; name: string; active: boolean }
>(setter: (updater: (prev: T[]) => T[]) => void, payload: RealtimePostgresChangesPayload<T>) {
  if (payload.eventType === "DELETE") {
    const oldId = payload.old.id;
    if (!oldId) return;
    setter((prev) => prev.filter((x) => x.id !== oldId));
    return;
  }
  const row = payload.new;
  setter((prev) => {
    const withoutRow = prev.filter((x) => x.id !== row.id);
    return row.active ? sortFlatList([...withoutRow, row]) : withoutRow;
  });
}

// Products and dividers share one render-time sort (see `combined` in the
// component), so raw array order doesn't matter here — just keep the right
// rows in it. Products use the same "archive" pattern as above; dividers
// are actually deleted.
function applyUnsortedListChange<T extends { id: string; active?: boolean }>(
  setter: (updater: (prev: T[]) => T[]) => void,
  payload: RealtimePostgresChangesPayload<T>
) {
  if (payload.eventType === "DELETE") {
    const oldId = payload.old.id;
    if (!oldId) return;
    setter((prev) => prev.filter((x) => x.id !== oldId));
    return;
  }
  const row = payload.new;
  setter((prev) => {
    const withoutRow = prev.filter((x) => x.id !== row.id);
    if (row.active === false) return withoutRow;
    return [...withoutRow, row];
  });
}

// The week-scoped "one row per key" tables (PO info, packaging/label
// on-hand counts) — keyed by something other than `id` (distributor_id,
// item_key, product_id, item_id) and never actually deleted from this
// page. Skips a change that was this browser's own edit echoing back — the
// optimistic local update already reflects it, and re-applying it out of
// order mid-keystroke could make an in-progress edit visibly jump.
function applyKeyedRecordChange<T extends { id: string; updated_by?: string | null }>(
  setter: (updater: (prev: Record<string, T>) => Record<string, T>) => void,
  keyOf: (row: T) => string,
  currentUserId: string | null,
  payload: RealtimePostgresChangesPayload<T>
) {
  if (payload.eventType === "DELETE") {
    const oldId = payload.old.id;
    if (!oldId) return;
    setter((prev) => {
      const entry = Object.entries(prev).find(([, v]) => v.id === oldId);
      if (!entry) return prev;
      const next = { ...prev };
      delete next[entry[0]];
      return next;
    });
    return;
  }
  const row = payload.new;
  if (currentUserId && row.updated_by === currentUserId) return;
  setter((prev) => ({ ...prev, [keyOf(row)]: row }));
}

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);

  const [week, setWeek] = useState<Week | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dividers, setDividers] = useState<SectionDivider[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [inventory, setInventory] = useState<Record<string, InventoryWithRemaining>>({});
  const [allocations, setAllocations] = useState<Record<string, AllocationCell>>({}); // key: productId:distributorId
  const [pos, setPos] = useState<Record<string, DistributorPO>>({}); // key: distributorId
  const [packaging, setPackaging] = useState<Record<string, PackagingInventoryRow>>({}); // key: item_key
  const [labelInventory, setLabelInventory] = useState<Record<string, LabelInventoryRow>>({}); // key: productId
  const [distributorPrices, setDistributorPrices] = useState<Record<string, DistributorPrice>>({}); // key: productId:distributorId
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [newProductAfter, setNewProductAfter] = useState("__end__");
  const [addingProduct, setAddingProduct] = useState(false);
  const [addProductError, setAddProductError] = useState<string | null>(null);
  const [newDividerLabel, setNewDividerLabel] = useState("");
  const [newDividerAfter, setNewDividerAfter] = useState("__end__");
  const [addingDivider, setAddingDivider] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [activeEditMode, setActiveEditMode] = useState<EditMode | null>(null);
  const [newDistributorName, setNewDistributorName] = useState("");
  const [newDistributorColor, setNewDistributorColor] = useState("");
  const [addingDistributor, setAddingDistributor] = useState(false);
  const [addDistributorError, setAddDistributorError] = useState<string | null>(null);
  const [customPackagingItems, setCustomPackagingItems] = useState<CustomPackagingItem[]>([]);
  const [customPackagingInventory, setCustomPackagingInventory] = useState<
    Record<string, CustomPackagingInventoryRow>
  >({}); // key: item_id
  const [newPackagingItemName, setNewPackagingItemName] = useState("");
  const [addingPackagingItem, setAddingPackagingItem] = useState(false);
  const [addPackagingItemError, setAddPackagingItemError] = useState<string | null>(null);
  const [customLabelItems, setCustomLabelItems] = useState<CustomLabelItem[]>([]);
  const [customLabelInventory, setCustomLabelInventory] = useState<
    Record<string, CustomLabelInventoryRow>
  >({}); // key: item_id
  const [newLabelItemName, setNewLabelItemName] = useState("");
  const [addingLabelItem, setAddingLabelItem] = useState(false);
  const [addLabelItemError, setAddLabelItemError] = useState<string | null>(null);

  // Label Inventory is pinned to Packaging Inventory's actual rendered
  // height (measured, not guessed) so it always matches exactly with no
  // blank space, scrolls internally for its longer list, and — critically
  // — can never grow unbounded and squeeze the allocation table below.
  const packagingCardRef = useRef<HTMLDivElement | null>(null);
  const [packagingCardHeight, setPackagingCardHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = packagingCardRef.current;
    if (!el) return;
    const measure = () => setPackagingCardHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

    const { data: weekData } = await supabase
      .from("weeks")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    setWeek(weekData as Week | null);

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
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setDistributors((distributorData as Distributor[]) ?? []);

    // Distributor pricing is standing catalog data, not tied to a week — set
    // on the Distributor Pricing page, used here to drive Order Value totals.
    const { data: priceData } = await supabase.from("distributor_prices").select("*");
    const priceMap: Record<string, DistributorPrice> = {};
    (priceData as DistributorPrice[] | null)?.forEach((row) => {
      priceMap[`${row.product_id}:${row.distributor_id}`] = row;
    });
    setDistributorPrices(priceMap);

    const { data: customPkgItemData } = await supabase
      .from("custom_packaging_items")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setCustomPackagingItems((customPkgItemData as CustomPackagingItem[]) ?? []);

    const { data: customLabelItemData } = await supabase
      .from("custom_label_items")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setCustomLabelItems((customLabelItemData as CustomLabelItem[]) ?? []);

    if (weekData) {
      const { data: invData } = await supabase
        .from("inventory_with_remaining")
        .select("*")
        .eq("week_id", weekData.id);

      const invMap: Record<string, InventoryWithRemaining> = {};
      (invData as InventoryWithRemaining[] | null)?.forEach((row) => {
        invMap[row.product_id] = row;
      });
      setInventory(invMap);

      const { data: allocData } = await supabase
        .from("allocations")
        .select("*")
        .eq("week_id", weekData.id);

      const allocMap: Record<string, AllocationCell> = {};
      (allocData as Allocation[] | null)?.forEach((row) => {
        allocMap[`${row.product_id}:${row.distributor_id}`] = {
          id: row.id,
          quantity: row.quantity,
          status_flag: row.status_flag,
        };
      });
      setAllocations(allocMap);

      const { data: poData } = await supabase
        .from("distributor_pos")
        .select("*")
        .eq("week_id", weekData.id);

      const poMap: Record<string, DistributorPO> = {};
      (poData as DistributorPO[] | null)?.forEach((row) => {
        poMap[row.distributor_id] = row;
      });
      setPos(poMap);

      const { data: packagingData } = await supabase
        .from("packaging_inventory")
        .select("*")
        .eq("week_id", weekData.id);

      const pkgMap: Record<string, PackagingInventoryRow> = {};
      (packagingData as PackagingInventoryRow[] | null)?.forEach((row) => {
        pkgMap[row.item_key] = row;
      });
      setPackaging(pkgMap);

      const { data: labelData } = await supabase
        .from("label_inventory")
        .select("*")
        .eq("week_id", weekData.id);

      const lblMap: Record<string, LabelInventoryRow> = {};
      (labelData as LabelInventoryRow[] | null)?.forEach((row) => {
        lblMap[row.product_id] = row;
      });
      setLabelInventory(lblMap);

      const { data: customPkgInvData } = await supabase
        .from("custom_packaging_inventory")
        .select("*")
        .eq("week_id", weekData.id);

      const customPkgInvMap: Record<string, CustomPackagingInventoryRow> = {};
      (customPkgInvData as CustomPackagingInventoryRow[] | null)?.forEach((row) => {
        customPkgInvMap[row.item_id] = row;
      });
      setCustomPackagingInventory(customPkgInvMap);

      const { data: customLabelInvData } = await supabase
        .from("custom_label_inventory")
        .select("*")
        .eq("week_id", weekData.id);

      const customLabelInvMap: Record<string, CustomLabelInventoryRow> = {};
      (customLabelInvData as CustomLabelInventoryRow[] | null)?.forEach((row) => {
        customLabelInvMap[row.item_id] = row;
      });
      setCustomLabelInventory(customLabelInvMap);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  // ---------------------------------------------------------------------
  // Live sync — so everyone looking at this page sees each other's edits
  // within about a second, no reload needed. Two channels: one for the
  // reference lists below (distributors, products, dividers, custom item
  // definitions, distributor pricing) that aren't tied to a specific week,
  // and one for this week's actual numbers (inventory, allocations, PO
  // info, packaging/label counts) that resubscribes if the open week ever
  // changes. Every table listened to here needs Supabase's live-sync turned
  // on — see the "enable realtime" migration for the one-time setup. (The
  // merge helpers themselves live at module scope above, next to
  // computeFlatInsertSortOrder.)
  // ---------------------------------------------------------------------

  // Reference lists — not tied to a specific week, so this channel is set
  // up once and stays open for the life of the page.
  useEffect(() => {
    const channel = supabase
      .channel("inventory-page:reference")
      .on<Distributor>(
        "postgres_changes",
        { event: "*", schema: "public", table: "distributors" },
        (payload) => applyArchivableListChange<Distributor>(setDistributors, payload)
      )
      .on<Product>(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        (payload) => applyUnsortedListChange<Product>(setProducts, payload)
      )
      .on<SectionDivider>(
        "postgres_changes",
        { event: "*", schema: "public", table: "section_dividers" },
        (payload) => applyUnsortedListChange<SectionDivider>(setDividers, payload)
      )
      .on<CustomPackagingItem>(
        "postgres_changes",
        { event: "*", schema: "public", table: "custom_packaging_items" },
        (payload) => applyArchivableListChange<CustomPackagingItem>(setCustomPackagingItems, payload)
      )
      .on<CustomLabelItem>(
        "postgres_changes",
        { event: "*", schema: "public", table: "custom_label_items" },
        (payload) => applyArchivableListChange<CustomLabelItem>(setCustomLabelItems, payload)
      )
      .on<DistributorPrice>(
        "postgres_changes",
        { event: "*", schema: "public", table: "distributor_prices" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old;
            if (!oldRow.product_id || !oldRow.distributor_id) return;
            setDistributorPrices((prev) => {
              const next = { ...prev };
              delete next[`${oldRow.product_id}:${oldRow.distributor_id}`];
              return next;
            });
            return;
          }
          const row = payload.new;
          setDistributorPrices((prev) => ({
            ...prev,
            [`${row.product_id}:${row.distributor_id}`]: row,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // This week's actual numbers. Resubscribes if the open week ever changes.
  useEffect(() => {
    const weekId = week?.id;
    if (!weekId) return;

    const channel = supabase
      .channel(`inventory-page:week:${weekId}`)
      .on<InventoryWithRemaining>(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_snapshots", filter: `week_id=eq.${weekId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = payload.old.id;
            if (!oldId) return;
            setInventory((prev) => {
              const entry = Object.entries(prev).find(([, v]) => v.id === oldId);
              if (!entry) return prev;
              const next = { ...prev };
              delete next[entry[0]];
              return next;
            });
            return;
          }
          const row = payload.new;
          if (userId && row.updated_by === userId) return;
          setInventory((prev) => ({
            ...prev,
            [row.product_id]: { ...row, total: 0, remaining: 0 },
          }));
        }
      )
      .on<Allocation>(
        "postgres_changes",
        { event: "*", schema: "public", table: "allocations", filter: `week_id=eq.${weekId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = payload.old.id;
            if (!oldId) return;
            setAllocations((prev) => {
              const entry = Object.entries(prev).find(([, v]) => v.id === oldId);
              if (!entry) return prev;
              const next = { ...prev };
              delete next[entry[0]];
              return next;
            });
            return;
          }
          const row = payload.new;
          if (userId && row.updated_by === userId) return;
          setAllocations((prev) => ({
            ...prev,
            [`${row.product_id}:${row.distributor_id}`]: {
              id: row.id,
              quantity: row.quantity,
              status_flag: row.status_flag,
            },
          }));
        }
      )
      .on<DistributorPO>(
        "postgres_changes",
        { event: "*", schema: "public", table: "distributor_pos", filter: `week_id=eq.${weekId}` },
        (payload) =>
          applyKeyedRecordChange<DistributorPO>(setPos, (row) => row.distributor_id, userId, payload)
      )
      .on<PackagingInventoryRow>(
        "postgres_changes",
        { event: "*", schema: "public", table: "packaging_inventory", filter: `week_id=eq.${weekId}` },
        (payload) =>
          applyKeyedRecordChange<PackagingInventoryRow>(setPackaging, (row) => row.item_key, userId, payload)
      )
      .on<LabelInventoryRow>(
        "postgres_changes",
        { event: "*", schema: "public", table: "label_inventory", filter: `week_id=eq.${weekId}` },
        (payload) =>
          applyKeyedRecordChange<LabelInventoryRow>(setLabelInventory, (row) => row.product_id, userId, payload)
      )
      .on<CustomPackagingInventoryRow>(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "custom_packaging_inventory",
          filter: `week_id=eq.${weekId}`,
        },
        (payload) =>
          applyKeyedRecordChange<CustomPackagingInventoryRow>(
            setCustomPackagingInventory,
            (row) => row.item_id,
            userId,
            payload
          )
      )
      .on<CustomLabelInventoryRow>(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "custom_label_inventory",
          filter: `week_id=eq.${weekId}`,
        },
        (payload) =>
          applyKeyedRecordChange<CustomLabelInventoryRow>(
            setCustomLabelInventory,
            (row) => row.item_id,
            userId,
            payload
          )
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, week?.id, userId]);

  function totalFor(productId: string) {
    const inv = inventory[productId];
    if (!inv) return 0;
    return inv.on_hand + inv.unlabeled + inv.to_be_packaged;
  }

  function allocatedFor(productId: string) {
    return distributors.reduce(
      (sum, d) => sum + (allocations[`${productId}:${d.id}`]?.quantity ?? 0),
      0
    );
  }

  function remainingFor(productId: string) {
    return totalFor(productId) - allocatedFor(productId);
  }

  function orderValueFor(distributorId: string) {
    return products.reduce((sum, p) => {
      const qty = allocations[`${p.id}:${distributorId}`]?.quantity ?? 0;
      const price = distributorPrices[`${p.id}:${distributorId}`]?.price ?? 0;
      return sum + price * qty;
    }, 0);
  }

  const grandOrderValue = distributors.reduce((sum, d) => sum + orderValueFor(d.id), 0);

  // Packaging/label consumption, derived from each product's can/keg size
  // (parsed from its name) and its total allocated quantity across all
  // distributors this week. See lib/packaging.ts for the recipes.
  const consumption = computeConsumption(products, allocatedFor);

  // Only can-based products need a label row — kegs and tap handles don't.
  const labelProducts = products
    .filter((p) => derivePackaging(p.name).kind === "can")
    .sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER));

  // Products and brand dividers share one ordering, sorted together so the
  // grid can be grouped by brand like the original spreadsheet was.
  const combined: CombinedRow[] = [
    ...products.map((p): CombinedRow => ({ kind: "product", item: p })),
    ...dividers.map((d): CombinedRow => ({ kind: "divider", item: d })),
  ].sort((a, b) => rowSortOrder(a) - rowSortOrder(b));

  // Used by the "insert after" pickers when adding a new product or divider,
  // and by the up/down move buttons — finds the sort_order value that lands
  // a row at a specific spot without having to renumber anything else.
  function computeInsertSortOrder(afterKey: string): number {
    const maxOrder = combined.reduce((max, r) => Math.max(max, rowSortOrder(r)), 0);
    if (afterKey === "__end__") return maxOrder + 1;
    if (afterKey === "__start__") {
      const minOrder = combined.reduce((min, r) => Math.min(min, rowSortOrder(r)), maxOrder);
      return minOrder - 1;
    }
    const idx = combined.findIndex((r) => rowKey(r) === afterKey);
    if (idx === -1) return maxOrder + 1;
    const anchor = rowSortOrder(combined[idx]);
    const next = idx + 1 < combined.length ? rowSortOrder(combined[idx + 1]) : anchor + 1;
    return (anchor + next) / 2;
  }

  async function handleMoveRow(index: number, direction: "up" | "down") {
    if (!userId) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= combined.length) return;

    const row = combined[index];
    const newOrder =
      direction === "up"
        ? (() => {
            const above = targetIndex - 1 >= 0 ? rowSortOrder(combined[targetIndex - 1]) : rowSortOrder(combined[targetIndex]) - 1;
            return (above + rowSortOrder(combined[targetIndex])) / 2;
          })()
        : (() => {
            const below =
              targetIndex + 1 < combined.length
                ? rowSortOrder(combined[targetIndex + 1])
                : rowSortOrder(combined[targetIndex]) + 1;
            return (rowSortOrder(combined[targetIndex]) + below) / 2;
          })();

    if (row.kind === "product") {
      setProducts((prev) => prev.map((p) => (p.id === row.item.id ? { ...p, sort_order: newOrder } : p)));
      await supabase.from("products").update({ sort_order: newOrder }).eq("id", row.item.id);
    } else {
      setDividers((prev) => prev.map((d) => (d.id === row.item.id ? { ...d, sort_order: newOrder } : d)));
      await supabase.from("section_dividers").update({ sort_order: newOrder }).eq("id", row.item.id);
    }
  }

  async function handleAddDivider() {
    const label = newDividerLabel.trim();
    if (!label || !userId) return;
    setAddingDivider(true);

    const sortOrder = computeInsertSortOrder(newDividerAfter);
    const { data, error } = await supabase
      .from("section_dividers")
      .insert({ label, sort_order: sortOrder })
      .select()
      .single();

    if (!error && data) {
      setDividers((prev) => [...prev, data as SectionDivider]);
      setNewDividerLabel("");
      setNewDividerAfter("__end__");
    }
    setAddingDivider(false);
  }

  async function handleDeleteDivider(dividerId: string) {
    const { error } = await supabase.from("section_dividers").delete().eq("id", dividerId);
    if (!error) {
      setDividers((prev) => prev.filter((d) => d.id !== dividerId));
    }
  }

  // Same "insert after" positioning as computeInsertSortOrder above, just
  // over the flat distributors list (columns, not rows — no dividers here).
  function computeDistributorInsertSortOrder(afterKey: string): number {
    return computeFlatInsertSortOrder(distributors, afterKey);
  }

  async function handleAddDistributor() {
    const name = newDistributorName.trim();
    if (!name || !userId) return;
    setAddingDistributor(true);
    setAddDistributorError(null);

    // Always added at the end — reorder afterward with the ◀ ▶ buttons in
    // the manager panel, instead of a separate position picker up front.
    const sortOrder = computeDistributorInsertSortOrder("__end__");
    const color = newDistributorColor.trim() || null;

    const { data, error } = await supabase
      .from("distributors")
      .insert({ name, color, active: true, sort_order: sortOrder })
      .select()
      .single();

    if (error) {
      // Most common case: a distributor with this exact name already exists
      // (distributors.name has a unique index).
      setAddDistributorError(
        error.code === "23505" ? "A distributor with that name already exists." : error.message
      );
      setAddingDistributor(false);
      return;
    }

    setDistributors((prev) =>
      [...prev, data as Distributor].sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      })
    );
    setNewDistributorName("");
    setNewDistributorColor("");
    setAddingDistributor(false);

    await logChange(supabase, {
      weekId: week?.id ?? null,
      tableName: "distributors",
      recordId: data.id,
      fieldName: "name",
      oldValue: null,
      newValue: name,
      changedBy: userId,
    });
  }

  async function handleArchiveDistributor(distributorId: string) {
    if (!userId) return;

    const key = `archive-distributor:${distributorId}`;
    setSavingKey(key);

    const { error } = await supabase
      .from("distributors")
      .update({ active: false })
      .eq("id", distributorId);

    if (!error) {
      setDistributors((prev) => prev.filter((d) => d.id !== distributorId));
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "distributors",
        recordId: distributorId,
        fieldName: "active",
        oldValue: true,
        newValue: false,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  // Renaming saves on every keystroke (same convention as PO # elsewhere on
  // this page) rather than on blur — kept snappy since it's a single short
  // text field, not a big form.
  async function handleRenameDistributor(distributorId: string, name: string) {
    if (!userId) return;
    const existing = distributors.find((d) => d.id === distributorId);
    if (!existing) return;

    // Update locally right away so typing feels instant; don't re-sort the
    // list mid-edit (that happens naturally next time the page loads).
    setDistributors((prev) => prev.map((d) => (d.id === distributorId ? { ...d, name } : d)));

    const trimmed = name.trim();
    if (!trimmed) return; // don't persist a blank name while mid-edit

    const { error } = await supabase
      .from("distributors")
      .update({ name: trimmed })
      .eq("id", distributorId);

    if (!error && existing.name !== trimmed) {
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "distributors",
        recordId: distributorId,
        fieldName: "name",
        oldValue: existing.name,
        newValue: trimmed,
        changedBy: userId,
      });
    }
  }

  async function handleChangeDistributorColor(distributorId: string, color: string) {
    if (!userId) return;
    const existing = distributors.find((d) => d.id === distributorId);
    if (!existing) return;
    const newColor = color || null;

    setDistributors((prev) =>
      prev.map((d) => (d.id === distributorId ? { ...d, color: newColor } : d))
    );

    const { error } = await supabase
      .from("distributors")
      .update({ color: newColor })
      .eq("id", distributorId);

    if (!error) {
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "distributors",
        recordId: distributorId,
        fieldName: "color",
        oldValue: existing.color,
        newValue: newColor,
        changedBy: userId,
      });
    }
  }

  async function handleMoveDistributor(index: number, direction: "left" | "right") {
    if (!userId) return;
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= distributors.length) return;

    const order = (d: Distributor) => d.sort_order ?? Number.MAX_SAFE_INTEGER;
    const d = distributors[index];
    const newOrder =
      direction === "left"
        ? (() => {
            const before = targetIndex - 1 >= 0 ? order(distributors[targetIndex - 1]) : order(distributors[targetIndex]) - 1;
            return (before + order(distributors[targetIndex])) / 2;
          })()
        : (() => {
            const after =
              targetIndex + 1 < distributors.length
                ? order(distributors[targetIndex + 1])
                : order(distributors[targetIndex]) + 1;
            return (order(distributors[targetIndex]) + after) / 2;
          })();

    setDistributors((prev) => {
      const next = prev.map((x) => (x.id === d.id ? { ...x, sort_order: newOrder } : x));
      return next.sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });
    });
    await supabase.from("distributors").update({ sort_order: newOrder }).eq("id", d.id);
  }

  // Renaming a product/divider — same per-keystroke-save convention as
  // handleRenameDistributor above.
  async function handleRenameProduct(productId: string, name: string) {
    if (!userId) return;
    const existing = products.find((p) => p.id === productId);
    if (!existing) return;

    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, name } : p)));

    const trimmed = name.trim();
    if (!trimmed) return;

    const { error } = await supabase.from("products").update({ name: trimmed }).eq("id", productId);
    if (!error && existing.name !== trimmed) {
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "products",
        recordId: productId,
        fieldName: "name",
        oldValue: existing.name,
        newValue: trimmed,
        changedBy: userId,
      });
    }
  }

  async function handleRenameDivider(dividerId: string, label: string) {
    if (!userId) return;
    const existing = dividers.find((d) => d.id === dividerId);
    if (!existing) return;

    setDividers((prev) => prev.map((d) => (d.id === dividerId ? { ...d, label } : d)));

    const trimmed = label.trim();
    if (!trimmed) return;

    const { error } = await supabase
      .from("section_dividers")
      .update({ label: trimmed })
      .eq("id", dividerId);
    if (!error && existing.label !== trimmed) {
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "section_dividers",
        recordId: dividerId,
        fieldName: "label",
        oldValue: existing.label,
        newValue: trimmed,
        changedBy: userId,
      });
    }
  }

  // ---- Custom Packaging Inventory items (freeform, no consumption math) ----

  async function handleAddPackagingItem() {
    const name = newPackagingItemName.trim();
    if (!name || !userId) return;
    setAddingPackagingItem(true);
    setAddPackagingItemError(null);

    const sortOrder = computeFlatInsertSortOrder(customPackagingItems, "__end__");
    const { data, error } = await supabase
      .from("custom_packaging_items")
      .insert({ name, active: true, sort_order: sortOrder })
      .select()
      .single();

    if (error) {
      setAddPackagingItemError(
        error.code === "23505" ? "A packaging item with that name already exists." : error.message
      );
      setAddingPackagingItem(false);
      return;
    }

    setCustomPackagingItems((prev) => [...prev, data as CustomPackagingItem]);
    setNewPackagingItemName("");
    setAddingPackagingItem(false);

    await logChange(supabase, {
      weekId: week?.id ?? null,
      tableName: "custom_packaging_items",
      recordId: data.id,
      fieldName: "name",
      oldValue: null,
      newValue: name,
      changedBy: userId,
    });
  }

  async function handleRenamePackagingItem(itemId: string, name: string) {
    if (!userId) return;
    const existing = customPackagingItems.find((i) => i.id === itemId);
    if (!existing) return;

    setCustomPackagingItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, name } : i)));

    const trimmed = name.trim();
    if (!trimmed) return;

    const { error } = await supabase
      .from("custom_packaging_items")
      .update({ name: trimmed })
      .eq("id", itemId);
    if (!error && existing.name !== trimmed) {
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "custom_packaging_items",
        recordId: itemId,
        fieldName: "name",
        oldValue: existing.name,
        newValue: trimmed,
        changedBy: userId,
      });
    }
  }

  async function handleArchivePackagingItem(itemId: string) {
    if (!userId) return;
    const key = `archive-packaging-item:${itemId}`;
    setSavingKey(key);

    const { error } = await supabase
      .from("custom_packaging_items")
      .update({ active: false })
      .eq("id", itemId);

    if (!error) {
      setCustomPackagingItems((prev) => prev.filter((i) => i.id !== itemId));
      setCustomPackagingInventory((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "custom_packaging_items",
        recordId: itemId,
        fieldName: "active",
        oldValue: true,
        newValue: false,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleMovePackagingItem(index: number, direction: "up" | "down") {
    if (!userId) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= customPackagingItems.length) return;

    const order = (i: CustomPackagingItem) => i.sort_order ?? Number.MAX_SAFE_INTEGER;
    const item = customPackagingItems[index];
    const newOrder =
      direction === "up"
        ? (() => {
            const before =
              targetIndex - 1 >= 0
                ? order(customPackagingItems[targetIndex - 1])
                : order(customPackagingItems[targetIndex]) - 1;
            return (before + order(customPackagingItems[targetIndex])) / 2;
          })()
        : (() => {
            const after =
              targetIndex + 1 < customPackagingItems.length
                ? order(customPackagingItems[targetIndex + 1])
                : order(customPackagingItems[targetIndex]) + 1;
            return (order(customPackagingItems[targetIndex]) + after) / 2;
          })();

    setCustomPackagingItems((prev) => {
      const next = prev.map((x) => (x.id === item.id ? { ...x, sort_order: newOrder } : x));
      return next.sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });
    });
    await supabase.from("custom_packaging_items").update({ sort_order: newOrder }).eq("id", item.id);
  }

  async function handleCustomPackagingOnHandChange(itemId: string, value: number) {
    if (!week || !userId) return;
    const key = `custom-packaging:${itemId}`;
    setSavingKey(key);

    const existing = customPackagingInventory[itemId];
    const oldValue = existing?.on_hand_qty ?? 0;
    setCustomPackagingInventory((prev) => ({
      ...prev,
      [itemId]: {
        id: existing?.id ?? "",
        week_id: week.id,
        item_id: itemId,
        on_hand_qty: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("custom_packaging_inventory")
      .upsert(
        {
          week_id: week.id,
          item_id: itemId,
          on_hand_qty: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,item_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setCustomPackagingInventory((prev) => ({
        ...prev,
        [itemId]: data as CustomPackagingInventoryRow,
      }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "custom_packaging_inventory",
        recordId: data.id,
        fieldName: "on_hand_qty",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  // ---- Custom Label Inventory items (freeform, no consumption math) ----

  async function handleAddLabelItem() {
    const name = newLabelItemName.trim();
    if (!name || !userId) return;
    setAddingLabelItem(true);
    setAddLabelItemError(null);

    const sortOrder = computeFlatInsertSortOrder(customLabelItems, "__end__");
    const { data, error } = await supabase
      .from("custom_label_items")
      .insert({ name, active: true, sort_order: sortOrder })
      .select()
      .single();

    if (error) {
      setAddLabelItemError(
        error.code === "23505" ? "A label item with that name already exists." : error.message
      );
      setAddingLabelItem(false);
      return;
    }

    setCustomLabelItems((prev) => [...prev, data as CustomLabelItem]);
    setNewLabelItemName("");
    setAddingLabelItem(false);

    await logChange(supabase, {
      weekId: week?.id ?? null,
      tableName: "custom_label_items",
      recordId: data.id,
      fieldName: "name",
      oldValue: null,
      newValue: name,
      changedBy: userId,
    });
  }

  async function handleRenameLabelItem(itemId: string, name: string) {
    if (!userId) return;
    const existing = customLabelItems.find((i) => i.id === itemId);
    if (!existing) return;

    setCustomLabelItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, name } : i)));

    const trimmed = name.trim();
    if (!trimmed) return;

    const { error } = await supabase
      .from("custom_label_items")
      .update({ name: trimmed })
      .eq("id", itemId);
    if (!error && existing.name !== trimmed) {
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "custom_label_items",
        recordId: itemId,
        fieldName: "name",
        oldValue: existing.name,
        newValue: trimmed,
        changedBy: userId,
      });
    }
  }

  async function handleArchiveLabelItem(itemId: string) {
    if (!userId) return;
    const key = `archive-label-item:${itemId}`;
    setSavingKey(key);

    const { error } = await supabase
      .from("custom_label_items")
      .update({ active: false })
      .eq("id", itemId);

    if (!error) {
      setCustomLabelItems((prev) => prev.filter((i) => i.id !== itemId));
      setCustomLabelInventory((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "custom_label_items",
        recordId: itemId,
        fieldName: "active",
        oldValue: true,
        newValue: false,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleMoveLabelItem(index: number, direction: "up" | "down") {
    if (!userId) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= customLabelItems.length) return;

    const order = (i: CustomLabelItem) => i.sort_order ?? Number.MAX_SAFE_INTEGER;
    const item = customLabelItems[index];
    const newOrder =
      direction === "up"
        ? (() => {
            const before =
              targetIndex - 1 >= 0
                ? order(customLabelItems[targetIndex - 1])
                : order(customLabelItems[targetIndex]) - 1;
            return (before + order(customLabelItems[targetIndex])) / 2;
          })()
        : (() => {
            const after =
              targetIndex + 1 < customLabelItems.length
                ? order(customLabelItems[targetIndex + 1])
                : order(customLabelItems[targetIndex]) + 1;
            return (order(customLabelItems[targetIndex]) + after) / 2;
          })();

    setCustomLabelItems((prev) => {
      const next = prev.map((x) => (x.id === item.id ? { ...x, sort_order: newOrder } : x));
      return next.sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });
    });
    await supabase.from("custom_label_items").update({ sort_order: newOrder }).eq("id", item.id);
  }

  async function handleCustomLabelOnHandChange(itemId: string, value: number) {
    if (!week || !userId) return;
    const key = `custom-label:${itemId}`;
    setSavingKey(key);

    const existing = customLabelInventory[itemId];
    const oldValue = existing?.on_hand_qty ?? 0;
    setCustomLabelInventory((prev) => ({
      ...prev,
      [itemId]: {
        id: existing?.id ?? "",
        week_id: week.id,
        item_id: itemId,
        on_hand_qty: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("custom_label_inventory")
      .upsert(
        {
          week_id: week.id,
          item_id: itemId,
          on_hand_qty: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,item_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setCustomLabelInventory((prev) => ({ ...prev, [itemId]: data as CustomLabelInventoryRow }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "custom_label_inventory",
        recordId: data.id,
        fieldName: "on_hand_qty",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleInventoryChange(
    productId: string,
    field: InventoryEditableField,
    value: number
  ) {
    if (!week || !userId) return;
    const key = `inv:${productId}:${field}`;
    setSavingKey(key);

    const existing = inventory[productId];
    const oldValue = existing?.[field] ?? 0;

    const updated: InventoryWithRemaining = {
      id: existing?.id ?? "",
      week_id: week.id,
      product_id: productId,
      on_hand: field === "on_hand" ? value : existing?.on_hand ?? 0,
      unlabeled: field === "unlabeled" ? value : existing?.unlabeled ?? 0,
      to_be_packaged: field === "to_be_packaged" ? value : existing?.to_be_packaged ?? 0,
      total: 0,
      remaining: 0,
      status_flag: existing?.status_flag ?? null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    updated.total = updated.on_hand + updated.unlabeled + updated.to_be_packaged;
    setInventory((prev) => ({ ...prev, [productId]: updated }));

    const { data, error } = await supabase
      .from("inventory_snapshots")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          on_hand: updated.on_hand,
          unlabeled: updated.unlabeled,
          to_be_packaged: updated.to_be_packaged,
          status_flag: updated.status_flag,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id" }
      )
      .select()
      .single();

    if (!error && data) {
      await logChange(supabase, {
        weekId: week.id,
        tableName: "inventory_snapshots",
        recordId: data.id,
        fieldName: field,
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleAllocationChange(productId: string, distributorId: string, value: number) {
    if (!week || !userId) return;
    const key = `alloc:${productId}:${distributorId}`;
    setSavingKey(key);

    const mapKey = `${productId}:${distributorId}`;
    const existing = allocations[mapKey];
    const oldValue = existing?.quantity ?? 0;
    setAllocations((prev) => ({
      ...prev,
      [mapKey]: { id: existing?.id ?? "", quantity: value, status_flag: existing?.status_flag ?? null },
    }));

    const { data, error } = await supabase
      .from("allocations")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          distributor_id: distributorId,
          quantity: value,
          status_flag: existing?.status_flag ?? null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setAllocations((prev) => ({
        ...prev,
        [mapKey]: { ...prev[mapKey], id: data.id },
      }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "allocations",
        recordId: data.id,
        fieldName: "quantity",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleAllocationFlagChange(
    productId: string,
    distributorId: string,
    value: StatusFlag
  ) {
    if (!week || !userId) return;
    const mapKey = `${productId}:${distributorId}`;
    const key = `flag:${mapKey}`;
    setSavingKey(key);

    const existing = allocations[mapKey];
    const oldValue = existing?.status_flag ?? null;
    setAllocations((prev) => ({
      ...prev,
      [mapKey]: { id: existing?.id ?? "", quantity: existing?.quantity ?? 0, status_flag: value },
    }));

    const { data, error } = await supabase
      .from("allocations")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          distributor_id: distributorId,
          quantity: existing?.quantity ?? 0,
          status_flag: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setAllocations((prev) => ({
        ...prev,
        [mapKey]: { ...prev[mapKey], id: data.id },
      }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "allocations",
        recordId: data.id,
        fieldName: "status_flag",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleAddProduct() {
    const name = newProductName.trim();
    if (!name || !userId) return;
    setAddingProduct(true);
    setAddProductError(null);

    // Defaults to the very end of the list, but can be placed anywhere via
    // the "insert after" picker next to the input.
    const sortOrder = computeInsertSortOrder(newProductAfter);

    const { data, error } = await supabase
      .from("products")
      .insert({ name, active: true, sort_order: sortOrder })
      .select()
      .single();

    if (error) {
      // Most common case: a product with this exact name already exists
      // (products.name has a unique index).
      setAddProductError(
        error.code === "23505" ? "A product with that name already exists." : error.message
      );
      setAddingProduct(false);
      return;
    }

    setProducts((prev) => [...prev, data as Product]);
    setNewProductName("");
    setNewProductAfter("__end__");
    setAddingProduct(false);

    await logChange(supabase, {
      weekId: week?.id ?? null,
      tableName: "products",
      recordId: data.id,
      fieldName: "name",
      oldValue: null,
      newValue: name,
      changedBy: userId,
    });
  }

  async function handleArchiveProduct(productId: string) {
    if (!userId) return;

    const key = `archive:${productId}`;
    setSavingKey(key);

    const { error } = await supabase.from("products").update({ active: false }).eq("id", productId);

    if (!error) {
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "products",
        recordId: productId,
        fieldName: "active",
        oldValue: true,
        newValue: false,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handlePoNumberChange(distributorId: string, value: string) {
    if (!week || !userId) return;
    const key = `po:${distributorId}`;
    setSavingKey(key);

    const existing = pos[distributorId];
    const oldValue = existing?.po_number ?? "";
    setPos((prev) => ({
      ...prev,
      [distributorId]: {
        id: existing?.id ?? "",
        week_id: week.id,
        distributor_id: distributorId,
        po_number: value,
        po_status: existing?.po_status ?? null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("distributor_pos")
      .upsert(
        {
          week_id: week.id,
          distributor_id: distributorId,
          po_number: value,
          po_status: existing?.po_status ?? null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setPos((prev) => ({ ...prev, [distributorId]: data as DistributorPO }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "distributor_pos",
        recordId: data.id,
        fieldName: "po_number",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handlePoStatusChange(distributorId: string, value: PoStatus) {
    if (!week || !userId || !isAdmin) return;
    const key = `postatus:${distributorId}`;
    setSavingKey(key);

    const existing = pos[distributorId];
    const oldValue = existing?.po_status ?? "";
    setPos((prev) => ({
      ...prev,
      [distributorId]: {
        id: existing?.id ?? "",
        week_id: week.id,
        distributor_id: distributorId,
        po_number: existing?.po_number ?? null,
        po_status: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("distributor_pos")
      .upsert(
        {
          week_id: week.id,
          distributor_id: distributorId,
          po_number: existing?.po_number ?? null,
          po_status: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setPos((prev) => ({ ...prev, [distributorId]: data as DistributorPO }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "distributor_pos",
        recordId: data.id,
        fieldName: "po_status",
        oldValue,
        newValue: value ?? "",
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handlePackagingOnHandChange(itemKey: string, value: number) {
    if (!week || !userId) return;
    const key = `pkg:${itemKey}`;
    setSavingKey(key);

    const existing = packaging[itemKey];
    const oldValue = existing?.on_hand_qty ?? 0;
    setPackaging((prev) => ({
      ...prev,
      [itemKey]: {
        id: existing?.id ?? "",
        week_id: week.id,
        item_key: itemKey as PackagingInventoryRow["item_key"],
        on_hand_qty: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("packaging_inventory")
      .upsert(
        {
          week_id: week.id,
          item_key: itemKey,
          on_hand_qty: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,item_key" }
      )
      .select()
      .single();

    if (!error && data) {
      setPackaging((prev) => ({ ...prev, [itemKey]: data as PackagingInventoryRow }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "packaging_inventory",
        recordId: data.id,
        fieldName: "on_hand_qty",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleLabelOnHandChange(productId: string, value: number) {
    if (!week || !userId) return;
    const key = `lbl:${productId}`;
    setSavingKey(key);

    const existing = labelInventory[productId];
    const oldValue = existing?.on_hand_qty ?? 0;
    setLabelInventory((prev) => ({
      ...prev,
      [productId]: {
        id: existing?.id ?? "",
        week_id: week.id,
        product_id: productId,
        on_hand_qty: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("label_inventory")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          on_hand_qty: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setLabelInventory((prev) => ({ ...prev, [productId]: data as LabelInventoryRow }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "label_inventory",
        recordId: data.id,
        fieldName: "on_hand_qty",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  if (loading) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  if (!week) {
    return (
      <p className="text-sm text-neutral-400">
        No week has been started yet. An admin needs to start one from the Weeks page.
      </p>
    );
  }

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Inventory & Allocation</h1>
          <p className="text-sm text-neutral-400">{week.label}</p>
        </div>
        {savingKey && <p className="text-xs text-neutral-500">Saving…</p>}
      </div>

      <div className="flex flex-wrap gap-3">
        <div
          ref={packagingCardRef}
          className="min-w-[380px] flex-1 shrink-0 self-start rounded-lg border border-neutral-800 bg-neutral-950 p-3"
        >
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Packaging Inventory <span className="font-normal normal-case text-neutral-500">— Automatically adjusted as allocations are entered</span>
          </h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500">
                <th className="px-1.5 py-1 text-left">Item</th>
                <th className="px-1.5 py-1 text-right">On Hand</th>
                <th className="px-1.5 py-1 text-right">Consumed</th>
                <th className="px-1.5 py-1 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {PACKAGING_ITEMS.map((item) => {
                const onHand = packaging[item.key]?.on_hand_qty ?? 0;
                const consumed = consumption.packagingConsumed[item.key] ?? 0;
                const remaining = onHand - consumed;
                return (
                  <tr key={item.key}>
                    <td className="px-1.5 py-1 text-neutral-300">{item.label}</td>
                    <td className="px-1.5 py-1 text-right">
                      <input
                        type="number"
                        className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                        value={onHand}
                        onChange={(e) =>
                          handlePackagingOnHandChange(item.key, Number(e.target.value) || 0)
                        }
                      />
                    </td>
                    <td className="px-1.5 py-1 text-right text-neutral-400">{consumed}</td>
                    <td
                      className={`px-1.5 py-1 text-right font-semibold ${
                        remaining < 0 ? "text-red-400" : "text-neutral-200"
                      }`}
                    >
                      {remaining}
                    </td>
                  </tr>
                );
              })}
              {customPackagingItems.map((item, index) => {
                const onHand = customPackagingInventory[item.id]?.on_hand_qty ?? 0;
                const editing = activeEditMode === "packaging";
                return (
                  <tr key={item.id}>
                    <td className="px-1.5 py-1 text-neutral-300">
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <span className={EDIT_ICON_BTN}>
                            <button
                              onClick={() => handleMovePackagingItem(index, "up")}
                              disabled={index === 0}
                              title="Move up"
                              className="disabled:opacity-30"
                            >
                              ▲
                            </button>
                          </span>
                          <span className={EDIT_ICON_BTN}>
                            <button
                              onClick={() => handleMovePackagingItem(index, "down")}
                              disabled={index === customPackagingItems.length - 1}
                              title="Move down"
                              className="disabled:opacity-30"
                            >
                              ▼
                            </button>
                          </span>
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => handleRenamePackagingItem(item.id, e.target.value)}
                            className={`${EDIT_INPUT} w-28 px-1.5 py-0.5`}
                          />
                          <button
                            onClick={() => handleArchivePackagingItem(item.id)}
                            disabled={savingKey === `archive-packaging-item:${item.id}`}
                            title="Remove this packaging item (archives it — doesn't erase history)"
                            className={EDIT_ICON_BTN}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        item.name
                      )}
                    </td>
                    <td className="px-1.5 py-1 text-right">
                      <input
                        type="number"
                        className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                        value={onHand}
                        onChange={(e) =>
                          handleCustomPackagingOnHandChange(item.id, Number(e.target.value) || 0)
                        }
                      />
                    </td>
                    <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                    <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activeEditMode === "packaging" && (
            <div className={`${EDIT_PANEL} mt-2 flex flex-wrap items-center gap-2`}>
              <span className="shrink-0 text-neutral-400">Add packaging item:</span>
              <input
                type="text"
                placeholder="Item name…"
                value={newPackagingItemName}
                onChange={(e) => setNewPackagingItemName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPackagingItem()}
                className={`${EDIT_INPUT} w-40`}
              />
              <button
                onClick={handleAddPackagingItem}
                disabled={addingPackagingItem || !newPackagingItemName.trim()}
                className="shrink-0 rounded-md bg-yellow-500 px-3 py-1 text-xs font-medium text-black hover:bg-yellow-400 disabled:opacity-50"
              >
                {addingPackagingItem ? "Adding…" : "+ Add"}
              </button>
              {addPackagingItemError && (
                <span className="whitespace-nowrap text-red-400">{addPackagingItemError}</span>
              )}
              <p className="w-full text-neutral-500">
                Manually tracked only — no automatic consumption math, unlike the fixed items above.
              </p>
            </div>
          )}
        </div>

        <div
          className="flex max-h-96 min-h-0 min-w-[380px] flex-1 flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-3"
          style={packagingCardHeight ? { height: packagingCardHeight, flexGrow: 0 } : undefined}
        >
          <h2 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Label Inventory <span className="font-normal normal-case text-neutral-500">— Automatically adjusted as allocations are entered</span>
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500">
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-left">Product</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">On Hand</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Consumed</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {labelProducts.map((p) => {
                  const onHand = labelInventory[p.id]?.on_hand_qty ?? 0;
                  const consumed = consumption.labelConsumed[p.id] ?? 0;
                  const remaining = onHand - consumed;
                  return (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-1.5 py-1 text-neutral-300">{p.name}</td>
                      <td className="px-1.5 py-1 text-right">
                        <input
                          type="number"
                          className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                          value={onHand}
                          onChange={(e) =>
                            handleLabelOnHandChange(p.id, Number(e.target.value) || 0)
                          }
                        />
                      </td>
                      <td className="px-1.5 py-1 text-right text-neutral-400">{consumed}</td>
                      <td
                        className={`px-1.5 py-1 text-right font-semibold ${
                          remaining < 0 ? "text-red-400" : "text-neutral-200"
                        }`}
                      >
                        {remaining}
                      </td>
                    </tr>
                  );
                })}
                {customLabelItems.map((item, index) => {
                  const onHand = customLabelInventory[item.id]?.on_hand_qty ?? 0;
                  const editing = activeEditMode === "labels";
                  return (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap px-1.5 py-1 text-neutral-300">
                        {editing ? (
                          <div className="flex items-center gap-1">
                            <span className={EDIT_ICON_BTN}>
                              <button
                                onClick={() => handleMoveLabelItem(index, "up")}
                                disabled={index === 0}
                                title="Move up"
                                className="disabled:opacity-30"
                              >
                                ▲
                              </button>
                            </span>
                            <span className={EDIT_ICON_BTN}>
                              <button
                                onClick={() => handleMoveLabelItem(index, "down")}
                                disabled={index === customLabelItems.length - 1}
                                title="Move down"
                                className="disabled:opacity-30"
                              >
                                ▼
                              </button>
                            </span>
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => handleRenameLabelItem(item.id, e.target.value)}
                              className={`${EDIT_INPUT} w-24 px-1.5 py-0.5`}
                            />
                            <button
                              onClick={() => handleArchiveLabelItem(item.id)}
                              disabled={savingKey === `archive-label-item:${item.id}`}
                              title="Remove this label item (archives it — doesn't erase history)"
                              className={EDIT_ICON_BTN}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          item.name
                        )}
                      </td>
                      <td className="px-1.5 py-1 text-right">
                        <input
                          type="number"
                          className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                          value={onHand}
                          onChange={(e) =>
                            handleCustomLabelOnHandChange(item.id, Number(e.target.value) || 0)
                          }
                        />
                      </td>
                      <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                      <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {activeEditMode === "labels" && (
            <div className={`${EDIT_PANEL} mt-2 flex shrink-0 flex-wrap items-center gap-2`}>
              <span className="shrink-0 text-neutral-400">Add label item:</span>
              <input
                type="text"
                placeholder="Item name…"
                value={newLabelItemName}
                onChange={(e) => setNewLabelItemName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddLabelItem()}
                className={`${EDIT_INPUT} w-40`}
              />
              <button
                onClick={handleAddLabelItem}
                disabled={addingLabelItem || !newLabelItemName.trim()}
                className="shrink-0 rounded-md bg-yellow-500 px-3 py-1 text-xs font-medium text-black hover:bg-yellow-400 disabled:opacity-50"
              >
                {addingLabelItem ? "Adding…" : "+ Add"}
              </button>
              {addLabelItemError && (
                <span className="whitespace-nowrap text-red-400">{addLabelItemError}</span>
              )}
              <p className="w-full text-neutral-500">
                Manually tracked only — separate from each product&apos;s automatic label row above.
              </p>
            </div>
          )}
        </div>
      </div>

      {consumption.unrecognizedProducts.length > 0 && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Heads up — {consumption.unrecognizedProducts.length} product name(s) don&apos;t clearly
          state a can/keg size, so they&apos;re not included in the packaging/label totals above:{" "}
          {consumption.unrecognizedProducts.join(", ")}.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
        <span className="text-neutral-500">Cell colors (click a distributor cell&apos;s swatch):</span>
        {Object.entries(STATUS_FLAG_LABELS).map(([value, label]) => (
          <div key={value} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: STATUS_FLAG_COLORS[value as keyof typeof STATUS_FLAG_COLORS] }}
            />
            <span className="text-neutral-400">{label}</span>
          </div>
        ))}
      </div>

      {isAdmin && (
        <div className="flex flex-col gap-2">
          <div className="relative inline-block self-start">
            <button
              onClick={() => setEditMenuOpen((prev) => !prev)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                activeEditMode
                  ? "border-yellow-500/70 bg-yellow-500/10 text-yellow-300"
                  : "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              ✎ Edit
              {activeEditMode
                ? ` — ${EDIT_MODE_OPTIONS.find((o) => o.key === activeEditMode)?.label}`
                : ""}{" "}
              ▾
            </button>

            {editMenuOpen && (
              <div className="absolute left-0 z-30 mt-1 w-64 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
                {EDIT_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setActiveEditMode((prev) => (prev === opt.key ? null : opt.key));
                      setEditMenuOpen(false);
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-neutral-800 ${
                      activeEditMode === opt.key ? "bg-yellow-500/20 text-yellow-300" : "text-neutral-200"
                    }`}
                  >
                    {activeEditMode === opt.key ? "✓ " : ""}
                    {opt.label}
                  </button>
                ))}
                {activeEditMode && (
                  <button
                    onClick={() => {
                      setActiveEditMode(null);
                      setEditMenuOpen(false);
                    }}
                    className="block w-full border-t border-neutral-800 px-3 py-2 text-left text-xs text-neutral-400 hover:bg-neutral-800"
                  >
                    Done editing
                  </button>
                )}
              </div>
            )}
          </div>

          {activeEditMode === "distributors" && (
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex flex-col divide-y divide-neutral-900">
                {distributors.map((d, index) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() => handleMoveDistributor(index, "left")}
                        disabled={index === 0}
                        title="Move left"
                        className={EDIT_ICON_BTN}
                      >
                        ◀
                      </button>
                      <button
                        onClick={() => handleMoveDistributor(index, "right")}
                        disabled={index === distributors.length - 1}
                        title="Move right"
                        className={EDIT_ICON_BTN}
                      >
                        ▶
                      </button>
                    </span>
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => handleRenameDistributor(d.id, e.target.value)}
                      className={`${EDIT_INPUT} w-40`}
                    />
                    <select
                      value={d.color ?? ""}
                      onChange={(e) => handleChangeDistributorColor(d.id, e.target.value)}
                      className="w-32 rounded border border-yellow-500/70 px-2 py-1 text-xs font-semibold"
                      style={{
                        backgroundColor: d.color ?? "#171717",
                        color: d.color ? "#000000" : "#a3a3a3",
                      }}
                    >
                      <option value="" style={{ backgroundColor: "#171717", color: "#a3a3a3" }}>
                        — (no color)
                      </option>
                      {DISTRIBUTOR_COLOR_SWATCHES.map((c) => (
                        <option
                          key={c.hex}
                          value={c.hex}
                          style={{ backgroundColor: c.hex, color: "#000000" }}
                        >
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleArchiveDistributor(d.id)}
                      disabled={savingKey === `archive-distributor:${d.id}`}
                      title="Remove this distributor column (archives it — doesn't erase history)"
                      className={`ml-auto shrink-0 ${EDIT_ICON_BTN}`}
                    >
                      ✕ Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-2">
                <span className="shrink-0 text-neutral-400">Add new:</span>
                <input
                  type="text"
                  placeholder="Distributor name…"
                  className={`${EDIT_INPUT} w-40`}
                  value={newDistributorName}
                  onChange={(e) => setNewDistributorName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddDistributor()}
                />
                <select
                  value={newDistributorColor}
                  onChange={(e) => setNewDistributorColor(e.target.value)}
                  className="w-32 rounded border border-yellow-500/70 px-2 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: newDistributorColor || "#171717",
                    color: newDistributorColor ? "#000000" : "#a3a3a3",
                  }}
                >
                  <option value="" style={{ backgroundColor: "#171717", color: "#a3a3a3" }}>
                    — (no color)
                  </option>
                  {DISTRIBUTOR_COLOR_SWATCHES.map((c) => (
                    <option
                      key={c.hex}
                      value={c.hex}
                      style={{ backgroundColor: c.hex, color: "#000000" }}
                    >
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddDistributor}
                  disabled={addingDistributor || !newDistributorName.trim()}
                  className="shrink-0 rounded-md bg-yellow-500 px-3 py-1 text-xs font-medium text-black hover:bg-yellow-400 disabled:opacity-50"
                >
                  {addingDistributor ? "Adding…" : "+ Add Distributor"}
                </button>
                {addDistributorError && (
                  <span className="whitespace-nowrap text-red-400">{addDistributorError}</span>
                )}
              </div>
              <p className="text-neutral-500">
                New distributors are added at the end — use ◀ ▶ above to reposition. Removing
                archives a distributor rather than erasing its history.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
              <th className="sticky top-0 left-0 z-20 h-8 whitespace-nowrap bg-neutral-900 px-3 text-left">
                Product
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right">
                On Hand
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right">
                Unlabeled
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right">
                To Package
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold">
                Total
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
              <th className="sticky top-0 right-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold">
                Remaining
              </th>
            </tr>
            <tr className="h-7 text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="sticky top-8 left-0 z-20 h-7 whitespace-nowrap bg-neutral-900 px-3 text-left font-semibold">
                Order Value
              </th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {distributors.map((d) => (
                <th
                  key={d.id}
                  className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold text-neutral-200"
                >
                  {currencyFormatter.format(orderValueFor(d.id))}
                </th>
              ))}
              <th className="sticky top-8 right-0 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold text-neutral-100">
                Total: {currencyFormatter.format(grandOrderValue)}
              </th>
            </tr>
            <tr className="h-7 text-[10px] uppercase tracking-wide text-neutral-600">
              <th className="sticky top-[60px] left-0 z-20 h-7 whitespace-nowrap bg-neutral-900 px-3 text-left font-normal">
                PO # (Ekos)
              </th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {distributors.map((d) => (
                <th
                  key={d.id}
                  className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right"
                >
                  <input
                    type="text"
                    placeholder="PO #"
                    className="w-28 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-[11px] font-normal normal-case text-neutral-100"
                    value={pos[d.id]?.po_number ?? ""}
                    onChange={(e) => handlePoNumberChange(d.id, e.target.value)}
                  />
                </th>
              ))}
              <th className="sticky top-[60px] right-0 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
            </tr>
            <tr className="h-7 text-[10px] uppercase tracking-wide text-neutral-600">
              <th className="sticky top-[88px] left-0 z-20 h-7 whitespace-nowrap bg-neutral-900 px-3 text-left font-normal">
                PO Status
              </th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {distributors.map((d) => {
                const status = pos[d.id]?.po_status ?? "";
                const bgColor = status ? PO_STATUS_COLORS[status] : undefined;
                return (
                  <th
                    key={d.id}
                    className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right"
                  >
                    <select
                      value={status}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        handlePoStatusChange(d.id, (e.target.value || null) as PoStatus)
                      }
                      className="w-28 rounded border border-neutral-700 px-1 py-0.5 text-right text-[11px] font-semibold normal-case disabled:opacity-70"
                      style={{
                        backgroundColor: bgColor ?? "#171717",
                        color: bgColor ? "#000000" : "#737373",
                      }}
                    >
                      <option value="" style={{ backgroundColor: "#171717", color: "#a3a3a3" }}>
                        —
                      </option>
                      <option
                        value="approved"
                        style={{ backgroundColor: PO_STATUS_COLORS.approved, color: "#000000" }}
                      >
                        {PO_STATUS_LABELS.approved}
                      </option>
                      <option
                        value="pending"
                        style={{ backgroundColor: PO_STATUS_COLORS.pending, color: "#000000" }}
                      >
                        {PO_STATUS_LABELS.pending}
                      </option>
                      <option
                        value="delivered"
                        style={{ backgroundColor: PO_STATUS_COLORS.delivered, color: "#000000" }}
                      >
                        {PO_STATUS_LABELS.delivered}
                      </option>
                    </select>
                  </th>
                );
              })}
              <th className="sticky top-[88px] right-0 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {combined.map((row, index) => {
              const rowEditActive =
                row.kind === "divider" ? activeEditMode === "dividers" : activeEditMode === "items";
              const moveButtons = isAdmin && rowEditActive && (
                <span className="flex shrink-0 flex-col leading-none">
                  <button
                    onClick={() => handleMoveRow(index, "up")}
                    disabled={index === 0}
                    title="Move up"
                    className={EDIT_ICON_BTN}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => handleMoveRow(index, "down")}
                    disabled={index === combined.length - 1}
                    title="Move down"
                    className={EDIT_ICON_BTN}
                  >
                    ▼
                  </button>
                </span>
              );

              if (row.kind === "divider") {
                const d = row.item;
                return (
                  <tr key={rowKey(row)} className="bg-neutral-900/70">
                    <td colSpan={6 + distributors.length} className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        {moveButtons}
                        {isAdmin && activeEditMode === "dividers" ? (
                          <input
                            type="text"
                            value={d.label}
                            onChange={(e) => handleRenameDivider(d.id, e.target.value)}
                            className={`${EDIT_INPUT} text-xs font-semibold uppercase tracking-wide`}
                          />
                        ) : (
                          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
                            {d.label}
                          </span>
                        )}
                        {isAdmin && activeEditMode === "dividers" && (
                          <button
                            onClick={() => handleDeleteDivider(d.id)}
                            title="Remove this divider"
                            className={`ml-auto shrink-0 ${EDIT_ICON_BTN}`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              const p = row.item;
              const remaining = remainingFor(p.id);
              return (
                <tr key={rowKey(row)} className="group hover:bg-neutral-900/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                    <div className="flex items-center gap-1.5">
                      {moveButtons}
                      {isAdmin && activeEditMode === "items" && (
                        <button
                          onClick={() => handleArchiveProduct(p.id)}
                          disabled={savingKey === `archive:${p.id}`}
                          title="Remove this product from the grid (archives it — doesn't erase history)"
                          className={EDIT_ICON_BTN}
                        >
                          ✕
                        </button>
                      )}
                      {isAdmin && activeEditMode === "items" ? (
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => handleRenameProduct(p.id, e.target.value)}
                          className={EDIT_INPUT}
                        />
                      ) : (
                        <span>{p.name}</span>
                      )}
                    </div>
                  </td>
                  {(["on_hand", "unlabeled", "to_be_packaged"] as const).map((field) => (
                    <td key={field} className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                        value={inventory[p.id]?.[field] ?? 0}
                        onChange={(e) =>
                          handleInventoryChange(p.id, field, Number(e.target.value) || 0)
                        }
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-semibold text-neutral-300">
                    {totalFor(p.id)}
                  </td>
                  {distributors.map((d) => {
                    const cell = allocations[`${p.id}:${d.id}`];
                    const flag = cell?.status_flag ?? null;
                    const flagColor = flag ? STATUS_FLAG_COLORS[flag] : null;
                    return (
                      <td key={d.id} className="px-2 py-1.5 text-right">
                        <div className="relative inline-block">
                          <input
                            type="number"
                            className="w-16 rounded border border-neutral-700 px-1.5 py-0.5 text-right"
                            style={{
                              backgroundColor: flagColor ?? "#171717",
                              color: flagColor ? "#000000" : "#f5f5f5",
                            }}
                            value={cell?.quantity ?? 0}
                            onChange={(e) =>
                              handleAllocationChange(p.id, d.id, Number(e.target.value) || 0)
                            }
                          />
                          {/* Tiny corner swatch — click to color-code this cell. Kept small and
                              overlapping the input's corner instead of a separate control, since
                              the cell itself (the input's background) is what shows the color. */}
                          <select
                            aria-label="Color code this cell"
                            className="absolute -right-1 -top-1 h-3 w-3 cursor-pointer appearance-none overflow-hidden rounded-full border border-neutral-950 p-0 text-xs leading-none"
                            style={{ backgroundColor: flagColor ?? "#525252" }}
                            value={flag ?? ""}
                            title={flag ? STATUS_FLAG_LABELS[flag] : "Color code this cell"}
                            onChange={(e) =>
                              handleAllocationFlagChange(
                                p.id,
                                d.id,
                                (e.target.value || null) as StatusFlag
                              )
                            }
                          >
                            <option value="" style={{ backgroundColor: "#404040", color: "#f5f5f5" }}>
                              — (no color)
                            </option>
                            {Object.entries(STATUS_FLAG_LABELS).map(([value, label]) => (
                              <option
                                key={value}
                                value={value}
                                style={{
                                  backgroundColor:
                                    STATUS_FLAG_COLORS[value as keyof typeof STATUS_FLAG_COLORS],
                                  color: "#000000",
                                }}
                              >
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    );
                  })}
                  <td
                    className={`sticky right-0 z-10 bg-neutral-950 px-2 py-1.5 text-right font-semibold group-hover:bg-neutral-900 ${
                      remaining < 0 ? "text-red-400" : "text-neutral-200"
                    }`}
                  >
                    {remaining}
                  </td>
                </tr>
              );
            })}
            {isAdmin && activeEditMode === "items" && (
              <tr className="border-t border-neutral-800">
                <td colSpan={6 + distributors.length} className="bg-neutral-950 px-3 py-2">
                  <div className={`flex flex-wrap items-center gap-2 ${EDIT_PANEL}`}>
                    <input
                      type="text"
                      placeholder="New product name…"
                      className={`w-56 text-sm ${EDIT_INPUT}`}
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddProduct()}
                    />
                    <span className="text-xs text-neutral-500">position:</span>
                    <select
                      className={`text-xs ${EDIT_INPUT}`}
                      value={newProductAfter}
                      onChange={(e) => setNewProductAfter(e.target.value)}
                    >
                      <option value="__start__">At the very top</option>
                      <option value="__end__">At the end (bottom)</option>
                      {combined.map((r) => (
                        <option key={rowKey(r)} value={rowKey(r)}>
                          After: {rowLabel(r)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddProduct}
                      disabled={addingProduct || !newProductName.trim()}
                      className="shrink-0 rounded-md bg-yellow-500 px-3 py-1 text-xs font-medium text-black hover:bg-yellow-400 disabled:opacity-50"
                    >
                      {addingProduct ? "Adding…" : "+ Add Product"}
                    </button>
                    {addProductError && (
                      <span className="whitespace-nowrap text-xs text-red-400">{addProductError}</span>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {isAdmin && activeEditMode === "dividers" && (
              <tr>
                <td colSpan={6 + distributors.length} className="bg-neutral-950 px-3 py-2">
                  <div className={`flex flex-wrap items-center gap-2 ${EDIT_PANEL}`}>
                    <input
                      type="text"
                      placeholder="New divider label (e.g. &quot;Sonoma Cider&quot;)…"
                      className={`w-56 text-sm ${EDIT_INPUT}`}
                      value={newDividerLabel}
                      onChange={(e) => setNewDividerLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddDivider()}
                    />
                    <span className="text-xs text-neutral-500">position:</span>
                    <select
                      className={`text-xs ${EDIT_INPUT}`}
                      value={newDividerAfter}
                      onChange={(e) => setNewDividerAfter(e.target.value)}
                    >
                      <option value="__start__">At the very top</option>
                      <option value="__end__">At the end (bottom)</option>
                      {combined.map((r) => (
                        <option key={rowKey(r)} value={rowKey(r)}>
                          After: {rowLabel(r)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddDivider}
                      disabled={addingDivider || !newDividerLabel.trim()}
                      className="shrink-0 rounded-md bg-yellow-500 px-3 py-1 text-xs font-medium text-black hover:bg-yellow-400 disabled:opacity-50"
                    >
                      {addingDivider ? "Adding…" : "+ Add Divider"}
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Remaining updates live as you type — it&apos;s Total minus everything allocated across
        distributors. A negative number means you&apos;ve allocated more than you actually have.
        Click the small dot in the corner of a distributor cell to color-code it against the
        legend above — the cell itself changes color.
      </p>
    </div>
  );
}
