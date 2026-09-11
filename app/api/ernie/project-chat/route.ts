import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getErnieTools, buildErnieSystemPrompt, runErnieTool } from "@/lib/ernie/tools";
import { hasSection, getUserSections, ERNIE_SECTION } from "@/lib/permissions";
import { buildFileContentBlocks, captureCodeExecutionFile, logErnieToolExecution, type ErnieFileRow } from "@/lib/ernie/files";
import { firstNameFor } from "@/lib/displayName";

// The live, shared chat room for one Ernie Project (see
// sql/ernie_project_chat.sql) — replaces the old setup where each person got
// their own private conversation with Ernie inside a Project. Everyone with
// access to the Project posts into, and reads from, the exact same
// ernie_project_messages thread; the client picks up new rows live via
// Supabase Realtime (see ErnieChatClient.tsx), not by polling this route.
//
// General (non-Project) Ernie chat is untouched — this route only ever
// touches ernie_project_messages, never ernie_conversations/ernie_messages.
//
// GET  ?projectId=<id>  — the room's message history (RLS already scopes
//                          this to Projects the caller actually has access
//                          to; a stale/foreign id just comes back empty).
// POST { projectId, message, fileIds? } — posts the caller's message, then
//                          decides whether Ernie should reply and, if so,
//                          posts his reply too, in the SAME room, as its own
//                          message row. Both inserts show up for every open
//                          tab in the Project via Realtime — this route
//                          doesn't stream anything back itself.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY_MESSAGES = 40;

// Ernie is told to answer with exactly this token, and nothing else, when he
// judges the room doesn't need him to speak up right now. Anything else he
// returns is posted as a real message.
const NO_REPLY_SENTINEL = "NO_REPLY";

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
const WEB_FETCH_TOOL = {
  type: "web_fetch_20260318",
  name: "web_fetch",
  max_uses: 8,
  citations: { enabled: true },
  max_content_tokens: 50000,
};
const CODE_EXECUTION_TOOL = { type: "code_execution_20260120", name: "code_execution" };

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  // RLS on ernie_project_messages already limits this to Projects the caller
  // has an access grant for (or is an admin) — a Project they can't see just
  // comes back with an empty list rather than an error.
  const { data, error } = await supabase
    .from("ernie_project_messages")
    .select("id, sender_id, sender_name, role, content, file_ids, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_super_admin, full_name, email")
    .eq("id", user.id)
    .single();

  const role = profile?.role;
  const isSuperAdmin = profile?.is_super_admin === true;
  const sections = isSuperAdmin ? [] : await getUserSections(supabase, user.id);

  if (!hasSection(role, sections, ERNIE_SECTION)) {
    return NextResponse.json(
      { error: "Ernie isn't available on your account — ask an admin to grant Ernie AI access from Users." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    message?: string;
    fileIds?: string[];
  };
  const projectId = body.projectId;
  const messageText = body.message?.trim() ?? "";
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (!messageText && fileIds.length === 0) {
    return NextResponse.json({ error: "No message provided" }, { status: 400 });
  }

  // Re-verify the Project itself (RLS-gated — never trust the client's say-so
  // alone) rather than just letting the insert policy silently reject it, so
  // a stale/foreign projectId gets a clear error instead of a mystery no-op.
  const { data: project } = await supabase
    .from("ernie_projects")
    .select("id, name, description")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return NextResponse.json(
      { error: "That Project isn't available on your account — ask an admin for access." },
      { status: 403 },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY — add it in Vercel's Environment Variables and redeploy." },
      { status: 500 },
    );
  }

  // Never fall back to the bare email address — per Chad ("i didnt ask for
  // my email, i asked for our names"). This is the exact same fallback the
  // rest of the app already uses for a name (see lib/displayName.ts and its
  // matching use in TasksPageClient.tsx): a real full_name (set during
  // account setup) wins outright; an account that predates that flow, or
  // never had one filled in, falls back to a guessed first name from their
  // email instead of the address itself.
  const senderName =
    profile?.full_name?.trim() || firstNameFor({ full_name: profile?.full_name ?? null, email: profile?.email ?? "" });

  // Post the person's own message first — this is what makes it show up
  // live for everyone the instant it's inserted, before Ernie's turn (below)
  // even starts running.
  const { error: insertUserErr } = await supabase.from("ernie_project_messages").insert({
    project_id: projectId,
    sender_id: user.id,
    sender_name: senderName,
    role: "user",
    content: messageText,
    file_ids: fileIds,
  });
  if (insertUserErr) return NextResponse.json({ error: insertUserErr.message }, { status: 500 });

  // Recent room history for Ernie's context — capped so a long-running
  // Project's room doesn't grow this call unbounded. Each line is labeled
  // with the real sender's name so Ernie can actually follow who said what,
  // the way a person reading the room would.
  const { data: historyRows, error: historyErr } = await supabase
    .from("ernie_project_messages")
    .select("sender_name, role, content, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);
  if (historyErr) return NextResponse.json({ error: historyErr.message }, { status: 500 });

  const orderedHistory = [...(historyRows ?? [])].reverse();
  const transcript = orderedHistory
    .map((m) => `${m.role === "ernie" ? "Ernie" : m.sender_name}: ${m.content || "(no text — attached a file)"}`)
    .join("\n");

  // Personal notes aren't a thing here (this is a shared room, not any one
  // person's private conversation) — buildErnieSystemPrompt's personNotes
  // stays null on purpose.
  const groupChatSystemPrompt = `\n\nYou're reading a live, shared team chat room inside the Ernie Project "${project.name}"${
    project.description ? ` — ${project.description}` : ""
  }. Multiple people can post here, each message labeled with their real name; you (Ernie) are effectively one more participant in the room, not a 1:1 assistant. It has its own file library, separate from anyone's directly-uploaded files: query ernie_project_files (id, project_id, file_name, storage_path, description, mime_type, size_bytes, added_by, created_at) via run_read_only_query, filtered to project_id = '${project.id}', to see what's in it — read the whole table for this project rather than guessing a filter, since it's small. Use get_file_for_download (bucket "ernie-project-files") to hand one of those files over as a download.

Here is the recent conversation, oldest first:
${transcript}

Decide for yourself whether to say anything right now, the way a team member reading this channel would — most ordinary back-and-forth between people doesn't need your input, and jumping in on everything would be annoying. Reply only when you have something genuinely useful to add, are clearly being asked something you can help with, or are directly addressed by name. Decide this BEFORE calling any tools — if you're not going to reply, don't call any tools either.

If you decide NOT to say anything right now, respond with exactly this and nothing else: ${NO_REPLY_SENTINEL}

Otherwise, just write your reply as you normally would — it will be posted into the room under your name, so don't prefix it with "Ernie:" or address anyone by way of a greeting unless that's natural for the reply itself.`;

  let fileRows: ErnieFileRow[] = [];
  if (fileIds.length > 0) {
    const { data: filesData } = await supabase
      .from("ernie_files")
      .select("id, file_name, mime_type, size_bytes, storage_path")
      .in("id", fileIds);
    fileRows = filesData ?? [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape varies (text/image/document)
  const triggeringMessageBlocks: any[] = [];
  for (const file of fileRows) {
    triggeringMessageBlocks.push(...(await buildFileContentBlocks(supabase, file)));
  }
  triggeringMessageBlocks.push({
    type: "text",
    text:
      "(The message that was just posted, from " +
      senderName +
      (messageText ? `: "${messageText}"` : " — no text, just the attached file(s) above") +
      ". Decide whether to reply, per the instructions above.)",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic message content shape varies across the tool-use loop
  const anthropicMessages: any[] = [{ role: "user", content: triggeringMessageBlocks }];

  let finalText = "";
  const outputFileIds: string[] = [];
  // A dummy id — runErnieTool's currentConversationId param only ever uses
  // this to exclude "the conversation this came from" from a cross-
  // conversation search tool; there's no ernie_conversations row for a
  // Project room message, so there's nothing to exclude.
  const noConversationId = undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        system: buildErnieSystemPrompt(role, sections, isSuperAdmin, null) + groupChatSystemPrompt,
        tools: [...getErnieTools(role, sections, isSuperAdmin), WEB_SEARCH_TOOL, WEB_FETCH_TOOL, CODE_EXECUTION_TOOL],
        ...(isLastRound ? { tool_choice: { type: "none" } } : {}),
        messages: anthropicMessages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Ernie's backend returned an error (${res.status}): ${detail}`);
    }

    const data = await res.json();
    const content = data.content ?? [];

    for (const block of content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape varies
      const b = block as any;
      if (b.type === "server_tool_use" && b.name === "web_fetch") {
        // No ernie_conversations row exists for a Project room message —
        // logErnieToolExecution's conversation_id column references that
        // table, so this is left null rather than passing projectId (which
        // would just fail that foreign key and get silently swallowed).
        await logErnieToolExecution(supabase, user.id, undefined, "web_fetch", { url: b.input?.url });
      }
      if (b.type === "server_tool_use" && (b.name === "bash_code_execution" || b.name === "text_editor_code_execution")) {
        await logErnieToolExecution(supabase, user.id, undefined, b.name, b.input ?? {});
      }
      if (b.type === "bash_code_execution_tool_result") {
        const result = b.content;
        const files = result?.type === "bash_code_execution_result" ? result.content ?? [] : [];
        for (const f of files) {
          if (!f?.file_id) continue;
          try {
            const captured = await captureCodeExecutionFile(supabase, user.id, f.file_id);
            outputFileIds.push(captured.id);
          } catch {
            // A file the sandbox produced couldn't be captured — Ernie's
            // text reply still comes through; that file just won't show up.
          }
        }
      }
    }

    if (data.stop_reason === "tool_use") {
      anthropicMessages.push({ role: "assistant", content });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic tool_result content shape
      const toolResults: any[] = [];
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        let result: unknown;
        try {
          result = await runErnieTool(supabase, block.name, block.input ?? {}, role, sections, noConversationId, isSuperAdmin, user.id);
        } catch (toolErr) {
          result = { error: toolErr instanceof Error ? toolErr.message : "Tool lookup failed" };
        }
        if (
          (block.name === "edit_spreadsheet" ||
            block.name === "get_file_for_download" ||
            block.name === "export_pricing_data_as_spreadsheet" ||
            block.name === "fetch_url_as_file") &&
          result &&
          typeof result === "object" &&
          "id" in result &&
          typeof (result as { id: unknown }).id === "string"
        ) {
          outputFileIds.push((result as { id: string }).id);
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      anthropicMessages.push({ role: "user", content: toolResults });
      continue;
    }

    finalText = content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape
      .filter((b: any) => b.type === "text")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    break;
  }

  const staysSilent = !finalText || finalText.trim().toUpperCase() === NO_REPLY_SENTINEL;

  if (!staysSilent) {
    const { error: insertErnieErr } = await supabase.from("ernie_project_messages").insert({
      project_id: projectId,
      sender_id: null,
      sender_name: "Ernie",
      role: "ernie",
      content: finalText,
      file_ids: outputFileIds,
    });
    if (insertErnieErr) return NextResponse.json({ error: insertErnieErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ernieReplied: !staysSilent });
}
