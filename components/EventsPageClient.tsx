"use client";

// Events Calendar — FCB's outside/off-site events program (festivals,
// tastings, donations, distributor work-withs). Recreated from the old
// standalone "FCB Events" Electron app: same fields, same distributor
// color-coding, same POS Materials/Library concept, minus that app's
// GitHub-backed storage (now Supabase Storage + Postgres) and its 3D
// hover-tilt animation on calendar cells (dropped per Chad).
//
// Standing data, not tied to a week. Admin-only, full stop — the redirect
// guard lives in page.tsx; this component assumes it's only ever rendered
// for an admin.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type {
  CalendarEvent,
  Distributor,
  EventMaterial,
  EventType,
  PosLibraryFile,
} from "@/lib/types/db";
import {
  DAY_NAMES_FULL,
  DAY_NAMES_SHORT,
  EVENT_MATERIALS_BUCKET,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_OPTIONS,
  MONTH_NAMES,
  MONTH_NAMES_SHORT,
  buildMonthGrid,
  fileIcon,
  formatBytes,
  isImageFile,
  isoDate,
  parseIsoDate,
  storageFileName,
  type CalendarDay,
} from "@/lib/events";

function distributorColor(
  distributors: Distributor[],
  id: string | null,
): string {
  const d = id ? distributors.find((x) => x.id === id) : undefined;
  return d?.color || "#768390";
}

export default function EventsPageClient() {
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(() => new Date(), []);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [materialsByEvent, setMaterialsByEvent] = useState<
    Record<string, EventMaterial[]>
  >({});
  const [libraryFiles, setLibraryFiles] = useState<PosLibraryFile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<"calendar" | "library">("calendar");
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [distFilter, setDistFilter] = useState<string>("");

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "materials">(
    "details",
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formType, setFormType] = useState<EventType>("festival");
  const [formLocation, setFormLocation] = useState("");
  const [formDistributorId, setFormDistributorId] = useState("");
  const [formRep, setFormRep] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [attachFile, setAttachFile] = useState<PosLibraryFile | null>(null);
  const [attachSearch, setAttachSearch] = useState("");

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const eventFileInputRef = useRef<HTMLInputElement | null>(null);
  const libraryFileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const [distRes, eventsRes, materialsRes, libraryRes] = await Promise.all([
      supabase
        .from("distributors")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("name"),
      supabase
        .from("events")
        .select("*")
        .order("start_date", { ascending: true }),
      supabase
        .from("event_materials")
        .select("*")
        .order("uploaded_at", { ascending: true }),
      supabase
        .from("pos_library")
        .select("*")
        .order("uploaded_at", { ascending: false }),
    ]);

    setDistributors((distRes.data as Distributor[]) ?? []);
    setEvents((eventsRes.data as CalendarEvent[]) ?? []);

    const map: Record<string, EventMaterial[]> = {};
    (materialsRes.data as EventMaterial[] | null)?.forEach((m) => {
      (map[m.event_id] ??= []).push(m);
    });
    setMaterialsByEvent(map);
    setLibraryFiles((libraryRes.data as PosLibraryFile[]) ?? []);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();

    const channel = supabase
      .channel("events-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_materials" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_library" },
        load,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  // Lazily fetch signed preview URLs for image files currently visible
  // (the selected event's materials, or the library grid) rather than for
  // every file up front.
  useEffect(() => {
    const paths = new Set<string>();
    if (view === "library") {
      libraryFiles
        .filter((f) => isImageFile(f.file_name))
        .forEach((f) => paths.add(f.storage_path));
    } else if (selectedEventId) {
      (materialsByEvent[selectedEventId] ?? [])
        .filter((m) => isImageFile(m.file_name))
        .forEach((m) => paths.add(m.storage_path));
    }
    const missing = Array.from(paths).filter((p) => !signedUrls[p]);
    if (!missing.length) return;

    (async () => {
      const entries = await Promise.all(
        missing.map(async (p) => {
          const { data } = await supabase.storage
            .from(EVENT_MATERIALS_BUCKET)
            .createSignedUrl(p, 300);
          return [p, data?.signedUrl ?? ""] as const;
        }),
      );
      setSignedUrls((prev) => {
        const next = { ...prev };
        entries.forEach(([p, url]) => {
          if (url) next[p] = url;
        });
        return next;
      });
    })();
  }, [
    view,
    selectedEventId,
    materialsByEvent,
    libraryFiles,
    supabase,
    signedUrls,
  ]);

  const filteredEvents = useMemo(
    () =>
      events.filter((ev) => !distFilter || ev.distributor_id === distFilter),
    [events, distFilter],
  );
  const grid: CalendarDay[] = useMemo(
    () => buildMonthGrid(calYear, calMonth, filteredEvents),
    [calYear, calMonth, filteredEvents],
  );
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  function goPrevMonth() {
    setSelectedEventId(null);
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear((y) => y - 1);
    } else {
      setCalMonth((m) => m - 1);
    }
  }
  function goNextMonth() {
    setSelectedEventId(null);
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear((y) => y + 1);
    } else {
      setCalMonth((m) => m + 1);
    }
  }
  function goToday() {
    setCalYear(today.getFullYear());
    setCalMonth(today.getMonth());
    setSelectedEventId(null);
  }

  function selectEvent(id: string) {
    setSelectedEventId(id);
    setDetailTab("details");
  }

  // ── Add/Edit modal ─────────────────────────────────────────────────────
  function openAddModal() {
    setEditingId(null);
    setFormTitle("");
    setFormStart(isoDate(today));
    setFormEnd("");
    setFormTime("");
    setFormType("festival");
    setFormLocation("");
    setFormDistributorId("");
    setFormRep("");
    setFormNotes("");
    setFormError(null);
    setModalOpen(true);
  }
  function openEditModal(ev: CalendarEvent) {
    setEditingId(ev.id);
    setFormTitle(ev.title);
    setFormStart(ev.start_date);
    setFormEnd(ev.end_date ?? "");
    setFormTime(ev.time_label ?? "");
    setFormType(ev.type);
    setFormLocation(ev.location ?? "");
    setFormDistributorId(ev.distributor_id ?? "");
    setFormRep(ev.rep ?? "");
    setFormNotes(ev.notes ?? "");
    setFormError(null);
    setModalOpen(true);
  }
  function closeModal() {
    setModalOpen(false);
  }

  async function handleSaveEvent() {
    if (!userId) return;
    const title = formTitle.trim();
    if (!title) {
      setFormError("Event title is required.");
      return;
    }
    if (!formStart) {
      setFormError("Start date is required.");
      return;
    }
    setSaving(true);
    setFormError(null);

    const payload = {
      title,
      start_date: formStart,
      end_date: formEnd || null,
      time_label: formTime.trim() || null,
      type: formType,
      location: formLocation.trim() || null,
      distributor_id: formDistributorId || null,
      rep: formRep.trim() || null,
      notes: formNotes.trim() || null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      const previousTitle = events.find((e) => e.id === editingId)?.title ?? "";
      const { error } = await supabase
        .from("events")
        .update(payload)
        .eq("id", editingId);
      if (error) {
        setFormError(error.message);
        setSaving(false);
        return;
      }
      await logChange(supabase, {
        weekId: null,
        tableName: "events",
        recordId: editingId,
        fieldName: "title",
        oldValue: previousTitle,
        newValue: title,
        changedBy: userId,
      });
      setSelectedEventId(editingId);
    } else {
      const { data, error } = await supabase
        .from("events")
        .insert({ ...payload, created_by: userId })
        .select()
        .single();
      if (error || !data) {
        setFormError(
          error?.message ?? "Something went wrong saving that event.",
        );
        setSaving(false);
        return;
      }
      const created = data as CalendarEvent;
      await logChange(supabase, {
        weekId: null,
        tableName: "events",
        recordId: created.id,
        fieldName: "title",
        oldValue: "",
        newValue: title,
        changedBy: userId,
      });
      setSelectedEventId(created.id);
    }

    setSaving(false);
    setModalOpen(false);
    await load();
  }

  async function handleDeleteEvent(ev: CalendarEvent) {
    if (!userId) return;
    if (
      !window.confirm(
        `Delete "${ev.title}"? This also removes its POS Materials list (the files themselves stay in the library/storage).`,
      )
    )
      return;
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    if (error) return;
    await logChange(supabase, {
      weekId: null,
      tableName: "events",
      recordId: ev.id,
      fieldName: "title",
      oldValue: ev.title,
      newValue: null,
      changedBy: userId,
    });
    setSelectedEventId(null);
    await load();
  }

  // ── POS Materials (per event) ──────────────────────────────────────────
  async function handleUploadMaterials(ev: CalendarEvent, fileList: FileList) {
    if (!userId || !fileList.length) return;
    setUploadingKey(`event:${ev.id}`);
    for (const file of Array.from(fileList)) {
      const path = `${ev.id}/${storageFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(EVENT_MATERIALS_BUCKET)
        .upload(path, file);
      if (uploadError) continue;
      await supabase.from("event_materials").insert({
        event_id: ev.id,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
      });
    }
    await logChange(supabase, {
      weekId: null,
      tableName: "event_materials",
      recordId: ev.id,
      fieldName: "materials",
      oldValue: null,
      newValue: `${fileList.length} file(s) uploaded to ${ev.title}`,
      changedBy: userId,
    });
    setUploadingKey(null);
    await load();
  }

  async function handleDeleteMaterial(m: EventMaterial, eventTitle: string) {
    if (!userId) return;
    if (!window.confirm(`Remove "${m.file_name}" from this event?`)) return;
    await supabase.storage
      .from(EVENT_MATERIALS_BUCKET)
      .remove([m.storage_path]);
    await supabase.from("event_materials").delete().eq("id", m.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "event_materials",
      recordId: m.id,
      fieldName: "materials",
      oldValue: `${m.file_name} on ${eventTitle}`,
      newValue: null,
      changedBy: userId,
    });
    await load();
  }

  async function handleViewFile(path: string) {
    let url = signedUrls[path];
    if (!url) {
      const { data } = await supabase.storage
        .from(EVENT_MATERIALS_BUCKET)
        .createSignedUrl(path, 300);
      url = data?.signedUrl ?? "";
      if (url) setSignedUrls((prev) => ({ ...prev, [path]: url }));
    }
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  // ── POS Library ─────────────────────────────────────────────────────────
  async function handleLibraryUpload(fileList: FileList) {
    if (!userId || !fileList.length) return;
    setUploadingKey("library");
    for (const file of Array.from(fileList)) {
      const path = `library/${storageFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(EVENT_MATERIALS_BUCKET)
        .upload(path, file);
      if (uploadError) continue;
      await supabase.from("pos_library").insert({
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
      });
    }
    await logChange(supabase, {
      weekId: null,
      tableName: "pos_library",
      recordId: userId,
      fieldName: "library",
      oldValue: null,
      newValue: `${fileList.length} file(s) added to POS Library`,
      changedBy: userId,
    });
    setUploadingKey(null);
    await load();
  }

  async function handleDeleteLibraryFile(f: PosLibraryFile) {
    if (!userId) return;
    if (
      !window.confirm(
        `Remove "${f.file_name}" from the library? This does not remove it from any event it's already attached to.`,
      )
    )
      return;
    await supabase.storage
      .from(EVENT_MATERIALS_BUCKET)
      .remove([f.storage_path]);
    await supabase.from("pos_library").delete().eq("id", f.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "pos_library",
      recordId: f.id,
      fieldName: "library",
      oldValue: f.file_name,
      newValue: null,
      changedBy: userId,
    });
    await load();
  }

  async function handleAttachToEvent(ev: CalendarEvent) {
    if (!attachFile || !userId) return;
    const already = (materialsByEvent[ev.id] ?? []).some(
      (m) => m.storage_path === attachFile.storage_path,
    );
    if (!already) {
      await supabase.from("event_materials").insert({
        event_id: ev.id,
        file_name: attachFile.file_name,
        storage_path: attachFile.storage_path,
        mime_type: attachFile.mime_type,
        size_bytes: attachFile.size_bytes,
        uploaded_by: userId,
      });
      await logChange(supabase, {
        weekId: null,
        tableName: "event_materials",
        recordId: ev.id,
        fieldName: "materials",
        oldValue: null,
        newValue: `${attachFile.file_name} attached from library to ${ev.title}`,
        changedBy: userId,
      });
    }
    setAttachFile(null);
    await load();
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  const tabBtnClass = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm font-medium ${
      active
        ? "border-neutral-600 bg-neutral-900 text-neutral-100"
        : "border-neutral-800 text-neutral-400 hover:bg-neutral-900"
    }`;
  const chipClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
      active
        ? "border-neutral-600 bg-neutral-900 text-neutral-100"
        : "border-neutral-800 text-neutral-400 hover:bg-neutral-900"
    }`;
  const detailTabClass = (active: boolean) =>
    `flex-1 border-b-2 px-3 py-2 ${
      active
        ? "border-yellow-500 text-yellow-400"
        : "border-transparent text-neutral-500 hover:text-neutral-300"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">
            Events Calendar
          </h1>
          <p className="text-sm text-neutral-400">
            FCB&apos;s outside/off-site events program — festivals, tastings,
            donations, and distributor work-withs.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={tabBtnClass(view === "calendar")}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setView("library")}
            className={tabBtnClass(view === "library")}
          >
            POS Library {libraryFiles.length ? `(${libraryFiles.length})` : ""}
          </button>
        </div>
      </div>

      {view === "calendar" ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goPrevMonth}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                >
                  ‹
                </button>
                <span className="w-44 text-center text-base font-semibold text-neutral-100">
                  {MONTH_NAMES[calMonth]} {calYear}
                </span>
                <button
                  type="button"
                  onClick={goNextMonth}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
                >
                  Today
                </button>
              </div>
              <button
                type="button"
                onClick={openAddModal}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200"
              >
                + Add Event
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDistFilter("")}
                className={chipClass(distFilter === "")}
              >
                <span className="h-2 w-2 rounded-full bg-neutral-500" />
                All Events
              </button>
              {distributors.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDistFilter(d.id)}
                  className={chipClass(distFilter === d.id)}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: d.color ?? "#768390" }}
                  />
                  {d.name}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-neutral-800">
              <div className="grid grid-cols-7 bg-neutral-900 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {DAY_NAMES_SHORT.map((d) => (
                  <div key={d} className="px-1 py-1.5">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-neutral-800">
                {grid.map((day) => (
                  <div
                    key={day.key}
                    className={`min-h-[92px] p-1.5 ${
                      day.inCurrentMonth
                        ? "bg-neutral-950"
                        : "bg-neutral-950/40 opacity-40"
                    }`}
                  >
                    <div
                      className={`mb-1 text-sm font-semibold ${
                        day.isToday ? "text-yellow-400" : "text-neutral-500"
                      }`}
                    >
                      {day.date.getDate()}
                    </div>
                    {day.events.slice(0, 3).map((ev) => {
                      const color = distributorColor(
                        distributors,
                        ev.distributor_id,
                      );
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => selectEvent(ev.id)}
                          title={ev.title}
                          className="mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[11px] font-medium"
                          style={{ background: `${color}28`, color }}
                        >
                          {ev.title}
                        </button>
                      );
                    })}
                    {day.events.length > 3 && (
                      <button
                        type="button"
                        onClick={() => selectEvent(day.events[0].id)}
                        className="text-[11px] text-neutral-500 hover:text-neutral-300"
                      >
                        +{day.events.length - 3} more
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {selectedEvent && (
            <div className="flex w-full flex-col rounded-lg border border-neutral-800 bg-neutral-950 lg:w-80 lg:shrink-0">
              <div className="flex items-start justify-between gap-2 border-b border-neutral-800 p-3">
                <div className="text-sm font-semibold text-neutral-100">
                  {selectedEvent.title}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEventId(null)}
                  className="text-neutral-500 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
              <div className="flex border-b border-neutral-800 text-xs font-semibold uppercase tracking-wide">
                <button
                  type="button"
                  onClick={() => setDetailTab("details")}
                  className={detailTabClass(detailTab === "details")}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab("materials")}
                  className={detailTabClass(detailTab === "materials")}
                >
                  POS Materials
                  {materialsByEvent[selectedEvent.id]?.length
                    ? ` (${materialsByEvent[selectedEvent.id].length})`
                    : ""}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 text-sm">
                {detailTab === "details" ? (
                  <EventDetails
                    event={selectedEvent}
                    distributors={distributors}
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    <input
                      ref={eventFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length)
                          handleUploadMaterials(selectedEvent, e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => eventFileInputRef.current?.click()}
                      disabled={uploadingKey === `event:${selectedEvent.id}`}
                      className="rounded-md border border-dashed border-neutral-700 px-3 py-4 text-center text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:border-yellow-600 hover:text-yellow-400 disabled:opacity-50"
                    >
                      {uploadingKey === `event:${selectedEvent.id}`
                        ? "Uploading…"
                        : "Click to upload POS materials"}
                    </button>

                    {(materialsByEvent[selectedEvent.id] ?? []).length === 0 ? (
                      <p className="py-4 text-center text-xs text-neutral-500">
                        No materials uploaded yet
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {(materialsByEvent[selectedEvent.id] ?? []).map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 p-2"
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-950 text-lg">
                              {isImageFile(m.file_name) &&
                              signedUrls[m.storage_path] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={signedUrls[m.storage_path]}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                fileIcon(m.file_name)
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleViewFile(m.storage_path)}
                              className="min-w-0 flex-1 truncate text-left text-xs text-neutral-200 hover:text-yellow-400"
                              title={m.file_name}
                            >
                              {m.file_name}
                            </button>
                            <span className="shrink-0 text-[10px] text-neutral-500">
                              {formatBytes(m.size_bytes)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteMaterial(m, selectedEvent.title)
                              }
                              className="shrink-0 text-neutral-500 hover:text-red-400"
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2 border-t border-neutral-800 p-3">
                <button
                  type="button"
                  onClick={() => openEditModal(selectedEvent)}
                  className="flex-1 rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-300 hover:bg-neutral-900"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteEvent(selectedEvent)}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:border-red-800 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-100">
              📁 POS Library{" "}
              <span className="text-sm font-normal text-neutral-500">
                {libraryFiles.length} file(s)
              </span>
            </h2>
            <input
              ref={libraryFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleLibraryUpload(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => libraryFileInputRef.current?.click()}
              disabled={uploadingKey === "library"}
              className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
            >
              {uploadingKey === "library" ? "Uploading…" : "+ Upload Files"}
            </button>
          </div>

          {libraryFiles.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              No files yet — upload your POS materials
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {libraryFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
                >
                  <button
                    type="button"
                    onClick={() => handleViewFile(f.storage_path)}
                    className="flex h-24 items-center justify-center overflow-hidden bg-neutral-900 text-3xl"
                  >
                    {isImageFile(f.file_name) && signedUrls[f.storage_path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={signedUrls[f.storage_path]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      fileIcon(f.file_name)
                    )}
                  </button>
                  <div className="p-2">
                    <div
                      className="truncate text-xs text-neutral-200"
                      title={f.file_name}
                    >
                      {f.file_name}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                      {formatBytes(f.size_bytes)}
                    </div>
                  </div>
                  <div className="flex border-t border-neutral-800 text-[11px] font-semibold uppercase tracking-wide">
                    <button
                      type="button"
                      onClick={() => setAttachFile(f)}
                      className="flex-1 border-r border-neutral-800 py-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-yellow-400"
                    >
                      Attach
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLibraryFile(f)}
                      className="flex-1 py-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-8">
          <div className="w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-100">
                {editingId ? "Edit Event" : "Add Event"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="text-neutral-500 hover:text-red-400"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Event Title *
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Rocklin Brewfest"
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    End Date (multi-day)
                  </label>
                  <input
                    type="date"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Time
                  </label>
                  <input
                    type="text"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    placeholder="5:00 PM – 8:30 PM"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Type
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as EventType)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                  >
                    {EVENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Location / Venue
                </label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="333 W 18th St, Merced, CA"
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Distributor
                  </label>
                  <select
                    value={formDistributorId}
                    onChange={(e) => setFormDistributorId(e.target.value)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                  >
                    <option value="">— None —</option>
                    {distributors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Rep / Staff
                  </label>
                  <input
                    type="text"
                    value={formRep}
                    onChange={(e) => setFormRep(e.target.value)}
                    placeholder="e.g. Bill, Art…"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Notes
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Donation amount, products, contact info…"
                  rows={4}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
                />
              </div>

              {formError && <p className="text-sm text-red-400">{formError}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-neutral-800 pt-4">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEvent}
                disabled={saving}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Event"}
              </button>
            </div>
          </div>
        </div>
      )}

      {attachFile && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-8">
          <div className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-100">
                Attach to Event
              </h2>
              <button
                type="button"
                onClick={() => setAttachFile(null)}
                className="text-neutral-500 hover:text-red-400"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-neutral-500">
              File: {attachFile.file_name}
            </p>
            <input
              type="text"
              value={attachSearch}
              onChange={(e) => setAttachSearch(e.target.value)}
              placeholder="Search events…"
              className="mb-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
            />
            <div className="max-h-72 overflow-y-auto rounded-md border border-neutral-800">
              {events
                .filter((ev) =>
                  ev.title.toLowerCase().includes(attachSearch.toLowerCase()),
                )
                .sort((a, b) => a.start_date.localeCompare(b.start_date))
                .map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => handleAttachToEvent(ev)}
                    className="flex w-full items-center gap-2 border-b border-neutral-800 px-3 py-2 text-left text-sm hover:bg-neutral-900 last:border-b-0"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: distributorColor(
                          distributors,
                          ev.distributor_id,
                        ),
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-neutral-200">
                      {ev.title}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {
                        MONTH_NAMES_SHORT[
                          parseIsoDate(ev.start_date)?.getMonth() ?? 0
                        ]
                      }{" "}
                      {parseIsoDate(ev.start_date)?.getDate()}
                    </span>
                  </button>
                ))}
              {events.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-neutral-500">
                  No events yet
                </p>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setAttachFile(null)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventDetails({
  event,
  distributors,
}: {
  event: CalendarEvent;
  distributors: Distributor[];
}) {
  const start = parseIsoDate(event.start_date);
  const end = event.end_date ? parseIsoDate(event.end_date) : null;
  const distributor = event.distributor_id
    ? distributors.find((d) => d.id === event.distributor_id)
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      {start && (
        <div>
          <div className="text-2xl font-bold text-yellow-400">
            {MONTH_NAMES_SHORT[start.getMonth()].toUpperCase()}{" "}
            {start.getDate()}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {DAY_NAMES_FULL[start.getDay()]}, {MONTH_NAMES[start.getMonth()]}{" "}
            {start.getDate()}, {start.getFullYear()}
            {end && event.end_date !== event.start_date
              ? ` – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}`
              : ""}
          </div>
        </div>
      )}
      {distributor && (
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Distributor
          </div>
          <span
            className="inline-block rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide"
            style={{
              background: `${distributor.color}22`,
              color: distributor.color ?? undefined,
              border: `1px solid ${distributor.color}44`,
            }}
          >
            {distributor.name}
          </span>
        </div>
      )}
      {event.time_label && (
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Time
          </div>
          <div className="text-neutral-200">{event.time_label}</div>
        </div>
      )}
      {event.location && (
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Location
          </div>
          <div className="text-neutral-200">{event.location}</div>
        </div>
      )}
      {event.rep && (
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Rep / Staff
          </div>
          <div className="text-neutral-200">{event.rep}</div>
        </div>
      )}
      <div>
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          Type
        </div>
        <div className="text-neutral-200">{EVENT_TYPE_LABELS[event.type]}</div>
      </div>
      {event.notes && (
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Notes
          </div>
          <div className="whitespace-pre-wrap text-neutral-300">
            {event.notes}
          </div>
        </div>
      )}
    </div>
  );
}
