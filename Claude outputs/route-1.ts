import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getErnieTools, buildErnieSystemPrompt, runErnieTool, describeErnieToolLabel } from "@/lib/ernie/tools";
import { hasSection, getUserSections, ERNIE_SECTION } from "@/lib/permissions";
import { buildFileContentBlocks, captureCodeExecutionFile, logErnieToolExecution, type ErnieFileRow } from "@/lib/ernie/files";
import { closeBrowseSession, logBrowseStep } from "@/lib/ernie/browser";
import { withHistoryCacheBreakpoint, addWrapUpNote, isReplyOutOfTime } from "@/lib/ernie/replyBudget";

// Ernie's chat backend. Open to every signed-in user, read-only: this route
// calls Claude's Messages API directly (Ernie's underlying model — never
// surfaced to the user) with a read-only set of data tools
// (lib/ernie/tools.ts) it can call to look up real app data. No tool here
// can write to the database. Which tools are on offer — and what the system
// prompt tells Ernie it can/can't do — depends on the caller's role: a
// Basic user only ever gets tools backed by tables their own RLS policies
// already let them read elsewhere in the app (see getErnieTools() and
// buildErnieSystemPrompt() in lib/ernie/tools.ts); admin-only data (Purchase
// Orders, Sales/pricing, Distributor Inventory, Build Orders, Events, POS
// Label Files, the user list) never reaches a Basic user through Ernie.
//
// The database (ernie_conversations / ernie_messages) is the source of
// truth for conversation history — the client only ever sends the ONE new
// message it wants to ask, which conversation it belongs to (omitted to
// start a new one), and the ids of any files attached to this message
// (fileIds — already uploaded straight to Storage by the client; see
// ErnieChatClient's handleFiles()). This route loads that conversation's
// prior messages itself, resolves any attached files into real Anthropic
// content blocks (lib/ernie/files.ts), runs the same tool-use back-and-forth
// with Claude's API as before, and persists both the new user message and
// Ernie's reply before responding. That's what lets a conversation survive
// navigating away from /ernie and back, a page refresh, or opening it from
// a different device — previously the full history only ever lived in the
// browser tab's memory.
//
// Streams progress as Server-Sent Events rather than a single JSON
// response, so the client can show a live "Checking inventory &
// allocations…" style status while Ernie works through its tool-use loop
// instead of one opaque "thinking" spinner (Chad's request, 2026-08-31).
// Only the final answer is ever persisted to ernie_messages — the
// intermediate status events are never saved, purely a live UI thing.

// Vercel kills a serverless function after its max duration — with no
// maxDuration set, that default is only 10 seconds on this app's Hobby
// plan. Reading a real PDF's full content (base64, now that it's actually
// sent to Anthropic instead of a placeholder — see the PDF-reread fix,
// 2026-09-11) can easily take longer than that on its own, before the
// tool-use loop even finishes, which is what a Gateway Timeout means:
// Vercel killed the function mid-request, so anything not already
// persisted (the assistant's own reply, only inserted at the very end) was
// lost even though everything already saved is untouched.
//
// Raised 60s -> 300s on 2026-09-23: with Fluid compute (on by default, and
// pinned on in vercel.json), Vercel's Hobby limit is now 5 minutes, not 60s.
// Needed for Ernie's own browser (lib/ernie/browser.ts), where poking around
// a site takes many steps, and it also gives heavy PDF reads more room.
export const maxDuration = 300;

const ANTHROPIC_MODEL = "claude-sonnet-5";
// Per Chad (2026-09-23): the old 8-step cap was far too low. Ernie's real
// limit is now TIME, not steps — see REPLY_WRAP_UP_AFTER_MS in
// lib/ernie/replyBudget.ts: once a reply has run ~3.5 minutes he's made to
// stop and answer with what he's found, so the reply is never lost to
// Vercel's 5-minute cutoff. 50 is only a runaway guard (e.g. a model stuck
// clicking the same button) — a real question should never get near it.
const MAX_TOOL_ROUNDS = 50;

// Anthropic's own hosted web search tool — unlike ERNIE_TOOLS (which we
// execute ourselves against Supabase), Anthropic runs this one server-side
// and resolves it within the same API response, so no extra handling is
// needed in the loop below beyond including it in the request. Billed
// per-search on the Anthropic account; max_uses caps it per Ernie reply.
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
};

// Anthropic's hosted web fetch tool (added 2026-09-09, see
// claude/ernie-sandbox-restrictions.md) — reads the actual content of a
// specific URL (HTML pages and PDFs), not just a search snippet. Resolved
// server-side within the same API response, same as WEB_SEARCH_TOOL
// above. Its own built-in safeguard: Claude can only fetch a URL that
// already appeared somewhere in the conversation (a user message, a prior
// search/fetch result) — never one it invents on its own. Doesn't cover
// images or spreadsheets from a URL — see fetch_url_as_file
// (lib/ernie/tools.ts) for that gap.
const WEB_FETCH_TOOL = {
  type: "web_fetch_20260318",
  name: "web_fetch",
  max_uses: 8,
  citations: { enabled: true },
  max_content_tokens: 50000,
};

// Anthropic's hosted code execution tool (added 2026-09-09, see
// claude/ernie-sandbox-restrictions.md) — Ernie's "create things" sandbox.
// Runs entirely in Anthropic's own sandboxed container: no FCB
// infrastructure, no live credentials reachable from inside it, zero
// network access from inside it, hard resource/time caps, ephemeral by
// default. A generated file only ever leaves as a file_id in the
// response — captured below via captureCodeExecutionFile and handed back
// into this same chat as a download chip, never anywhere else. Paired
// here with WEB_FETCH_TOOL (a current-enough version) so code execution
// itself carries no extra charge per Anthropic's pricing rule.
const CODE_EXECUTION_TOOL = {
  type: "code_execution_20260120",
  name: "code_execution",
};

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  // Files attached to THIS historical message (see the fix below for why
  // this matters — previously dropped entirely on reload).
  fileIds: string[];
}

function titleFromMessage(text: string) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New conversation";
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_super_admin")
    .eq("id", user.id)
    .single();

  const role = profile?.role;
  const isSuperAdmin = profile?.is_super_admin === true;
  // Administrators never need rows fetched (hasSection() short-circuits
  // true for them everywhere); a Manager (role='admin', not super) DOES
  // need real sections now, in case they hold an actual cashflow_dashboard
  // grant — see lib/getProfile.ts's matching comment.
  const sections = isSuperAdmin ? [] : await getUserSections(supabase, user.id);

  // Ernie is itself a grantable section (see lib/permissions.ts) — an admin
  // always has it; a Basic user needs it explicitly checked from Users >
  // Edit. Block the whole chat here rather than just filtering tools, since
  // Chad was explicit some people may not get Ernie at all.
  if (!hasSection(role, sections, ERNIE_SECTION)) {
    return NextResponse.json(
      { error: "Ernie isn't available on your account — ask an admin to grant Ernie AI access from Users." },
      { status: 403 },
    );
  }

  // Private per-user notes (see sql/ernie_user_notes.sql) — RLS scopes this
  // to the signed-in user's own row with no admin bypass at all, so this
  // plain select naturally only ever returns this same user's notes, never
  // anyone else's. Missing row (brand-new user) is expected, not an error.
  const { data: personNotesRow } = await supabase
    .from("ernie_user_notes")
    .select("notes")
    .eq("user_id", user.id)
    .maybeSingle();
  const personNotes = personNotesRow?.notes ?? null;

  const body = (await req.json()) as {
    conversationId?: string;
    message?: string;
    fileIds?: string[];
    projectId?: string;
  };
  const newMessageText = body.message?.trim() ?? "";
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  // A brand-new conversation started from inside an Ernie Project (see
  // sql/ernie_projects.sql) carries the project's id so it's created
  // already scoped to that project — re-verified here against this same
  // user's own RLS-gated view of ernie_projects (never trust the client's
  // say-so alone) so someone can't hand-craft a projectId they don't
  // actually have access to. An existing conversation already has its
  // project_id fixed from creation, so this only matters when starting a
  // new one (no conversationId on the request yet).
  let project: { id: string; name: string; description: string | null } | null = null;
  if (body.projectId && !body.conversationId) {
    const { data: projectRow } = await supabase
      .from("ernie_projects")
      .select("id, name, description")
      .eq("id", body.projectId)
      .maybeSingle();
    if (!projectRow) {
      return NextResponse.json(
        { error: "That Project isn't available on your account — ask an admin for access." },
        { status: 403 },
      );
    }
    project = projectRow;
  }

  if (!newMessageText && fileIds.length === 0) {
    return NextResponse.json({ error: "No message provided" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Server is missing ANTHROPIC_API_KEY — add it in Vercel's Environment Variables and redeploy.",
      },
      { status: 500 },
    );
  }

  const requestConversationId = body.conversationId;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // One id for this entire HTTP request / tool-use loop. Passed through
      // to every runErnieTool() call below so its propose-then-confirm
      // machinery (see loadConfirmedPendingAction in lib/ernie/tools.ts) can
      // structurally guarantee a "confirmed:true" call is never honored
      // inside the same turn that proposed it — only a later request (a
      // genuine new user message) carries a different requestId.
      const requestId = crypto.randomUUID();
      const replyStartedAt = Date.now();

      try {
        // Resolve (or create) the conversation this message belongs to, and
        // load its prior messages (RLS already restricts this to the
        // signed-in user's own conversations, so a stale/foreign id just
        // comes back empty).
        let conversationId = requestConversationId;
        let priorMessages: ChatMessage[] = [];

        if (conversationId) {
          const { data: existing, error: convErr } = await supabase
            .from("ernie_conversations")
            .select("id, project_id")
            .eq("id", conversationId)
            .maybeSingle();
          if (convErr) throw convErr;

          // An existing conversation's own project_id (set once, at
          // creation) is the source of truth for whether it's scoped to a
          // Project — re-fetched fresh every turn (rather than trusting
          // whatever the client happened to send) so Ernie's system prompt
          // always reflects the real, current project context.
          if (existing?.project_id) {
            const { data: projectRow } = await supabase
              .from("ernie_projects")
              .select("id, name, description")
              .eq("id", existing.project_id)
              .maybeSingle();
            project = projectRow ?? null;
          }

          if (!existing) {
            // Stale/invalid id (e.g. leftover in another browser's
            // sessionStorage, or the conversation was removed) — fall back
            // to starting a fresh conversation instead of erroring out.
            conversationId = undefined;
          } else {
            const { data: history, error: histErr } = await supabase
              .from("ernie_messages")
              .select("role, content, file_ids")
              .eq("conversation_id", conversationId)
              .order("created_at", { ascending: true });
            if (histErr) throw histErr;
            priorMessages = (history ?? []).map((m) => ({
              role: m.role as "user" | "assistant",
              text: m.content,
              fileIds: Array.isArray(m.file_ids) ? m.file_ids : [],
            }));
          }
        }

        if (!conversationId) {
          const { data: created, error: createErr } = await supabase
            .from("ernie_conversations")
            .insert({
              user_id: user.id,
              title: titleFromMessage(newMessageText),
              project_id: project?.id ?? null,
            })
            .select("id")
            .single();
          if (createErr) throw createErr;
          conversationId = created.id;
        }

        const { error: insertUserErr } = await supabase.from("ernie_messages").insert({
          conversation_id: conversationId,
          role: "user",
          content: newMessageText,
          file_ids: fileIds,
        });
        if (insertUserErr) throw insertUserErr;

        // Look up whichever files this message attached (RLS on ernie_files
        // scopes this to the caller's own files) and turn each into the
        // Anthropic content block(s) Claude can actually read — an image or
        // PDF goes in natively, a spreadsheet/CSV/text file gets rendered to
        // text first. See lib/ernie/files.ts for what each file kind becomes.
        let fileRows: ErnieFileRow[] = [];
        if (fileIds.length > 0) {
          const { data: filesData, error: filesErr } = await supabase
            .from("ernie_files")
            .select("id, file_name, mime_type, size_bytes, storage_path")
            .in("id", fileIds);
          if (filesErr) throw filesErr;
          fileRows = filesData ?? [];
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape varies (text/image/document)
        const newMessageContentBlocks: any[] = [];
        for (const file of fileRows) {
          newMessageContentBlocks.push(...(await buildFileContentBlocks(supabase, file)));
        }
        if (newMessageText) {
          newMessageContentBlocks.push({ type: "text", text: newMessageText });
        }

        // BUG FIX (2026-09-18): a past message's file_ids used to be dropped
        // entirely here — priorMessages only ever carried the typed text, so
        // an image/file attached to an EARLIER turn silently vanished from
        // what Claude sees the moment the conversation moved past that turn
        // (Ernie "forgetting" a label image, having to be re-attached). Worse,
        // a message that was JUST an attachment with no typed text replayed
        // back as an empty string — which Claude's Messages API rejects
        // outright ("messages.N: user messages must have non-empty content"),
        // crashing the whole request. Fix: re-resolve each historical user
        // message's real attachments into actual Anthropic content blocks
        // (same helper used for the new message below), and never let a
        // turn go out with zero content blocks.
        //
        // Trade-off, by design (confirmed with Chad): an attached image now
        // gets resent on every later message in the same conversation, not
        // just once — a modest, bounded per-image cost increase, not capped
        // to a fixed window, since these conversations are normally short.
        const historyFileIds = Array.from(new Set(priorMessages.flatMap((m) => m.fileIds)));
        let historyFileRows: ErnieFileRow[] = [];
        if (historyFileIds.length > 0) {
          const { data: historyFilesData, error: historyFilesErr } = await supabase
            .from("ernie_files")
            .select("id, file_name, mime_type, size_bytes, storage_path")
            .in("id", historyFileIds);
          if (historyFilesErr) throw historyFilesErr;
          historyFileRows = historyFilesData ?? [];
        }
        const historyFileById = new Map(historyFileRows.map((f) => [f.id, f]));

        const priorMessageBlocks = await Promise.all(
          priorMessages.map(async (m) => {
            if (m.role === "assistant") {
              // Claude's own past replies are always plain text (Ernie never
              // emits image/document blocks as output) and finalText always
              // has a non-empty fallback (see below), so no rebuilding
              // needed here — just guard against a genuinely blank row.
              return { role: "assistant", content: m.text || "(no reply text)" };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            const blocks: any[] = [];
            for (const fileId of m.fileIds) {
              const fileRow = historyFileById.get(fileId);
              if (fileRow) {
                blocks.push(...(await buildFileContentBlocks(supabase, fileRow)));
              }
            }
            if (m.text) {
              blocks.push({ type: "text", text: m.text });
            }
            // Safety net: even if every referenced file failed to resolve
            // (e.g. deleted from Storage) and there was no typed text, this
            // turn must still carry something — an empty content array is
            // exactly what Claude's API rejects.
            if (blocks.length === 0) {
              blocks.push({ type: "text", text: "(a previous message with an attachment)" });
            }
            return { role: "user", content: blocks };
          }),
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic message content shape varies (string vs. content blocks) across the tool-use loop
        const anthropicMessages: any[] = [
          ...priorMessageBlocks,
          { role: "user", content: newMessageContentBlocks },
        ];

        // Told to Ernie only when this conversation belongs to a Project
        // (see sql/ernie_projects.sql) — not a new tool, just a system-prompt
        // addendum, since run_read_only_query/get_file_for_download already
        // reach ernie_project_files automatically via that table's own RLS
        // (the same "no new tool needed" pattern as ernie_reference_documents).
        const projectSystemPrompt = project
          ? `\n\nThis conversation is happening inside the Ernie Project "${project.name}"${
              project.description ? ` — ${project.description}` : ""
            }. It has its own file library, separate from anyone's directly-uploaded files: query ernie_project_files (id, project_id, file_name, storage_path, description, mime_type, size_bytes, added_by, created_at) via run_read_only_query, filtered to project_id = '${project.id}', to see what's in it — read the whole table for this project rather than guessing a filter, since it's small. Use get_file_for_download (bucket "ernie-project-files") to actually hand one of those files over as a download. You only ever see the files of a Project you/this user have real access to — RLS enforces that automatically, the same as everywhere else.`
          : "";

        let finalText = "";
        // Files Ernie produced or fetched during this turn (edit_spreadsheet,
        // get_file_for_download) so they can be shown as download chips —
        // both live, via the "done" SSE event, and later, by persisting them
        // on the assistant's own ernie_messages row the same way a user
        // message's fileIds already work.
        const outputFileIds: string[] = [];
        // animate_image only ever starts a render (see lib/ernie/tools.ts,
        // lib/ernie/files.ts) — this is how the client learns which job(s)
        // to start polling app/api/ernie/video-jobs/[id] for, right away
        // rather than only discovering a pending render on next page load.
        const videoJobIds: string[] = [];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          // On the last round, force a plain-text answer instead of allowing
          // another tool call. Without this, a question the model can't
          // quite resolve (e.g. it keeps re-querying, unsatisfied with what
          // comes back) can burn through every round still on stop_reason
          // === "tool_use", leaving finalText empty and silently falling
          // through to the generic "I wasn't able to put together an
          // answer" message below — even though Claude may have already
          // gathered real, usable data along the way. Forcing tool_choice
          // "none" here means the last round always answers in text using
          // whatever's been collected so far, incomplete or not, rather
          // than going quiet.
          //
          // Also the last round once this reply is out of time (see
          // lib/ernie/replyBudget.ts) — Ernie is told to wrap up and answer
          // with what he has, instead of Vercel killing the reply mid-step.
          const outOfTime = isReplyOutOfTime(replyStartedAt);
          const isLastRound = round === MAX_TOOL_ROUNDS - 1 || outOfTime;
          if (outOfTime) addWrapUpNote(anthropicMessages);

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
              // Prompt caching (added 2026-09-14, "basic"/5-minute tier —
              // no ttl override means the default 5-min cache, cheapest to
              // write at 1.25x normal input cost, vs. 2x for a 1-hour
              // cache). The system prompt + full tool list are identical
              // on every one of this loop's own rounds (up to
              // MAX_TOOL_ROUNDS) for a single reply, AND identical across
              // separate messages/conversations for the same user role —
              // so this is re-sent and re-billed at full price today for
              // no reason. Marking cache_control on the system block and
              // on the last tool (a breakpoint caches everything *up to
              // and including* the marked block, so one marker on the
              // final tool covers the whole tools array regardless of how
              // many custom tools getErnieTools() returns for this role)
              // gets a ~90% discount on those tokens for any call that
              // reuses them within the cache's 5-minute window — which
              // covers this whole tool-use loop on its own, easily.
              // Conversation history is now cached too (2026-09-23): a
              // third breakpoint on the newest message (added fresh each
              // round by withHistoryCacheBreakpoint, never piling up) means
              // each step of a long reply — e.g. 30 browser clicks — pays
              // the discounted rate for everything already said, instead of
              // full price for the whole conversation every single step.
              system: [
                {
                  type: "text",
                  text: buildErnieSystemPrompt(role, sections, isSuperAdmin, personNotes) + projectSystemPrompt,
                  cache_control: { type: "ephemeral" },
                },
              ],
              tools: [
                ...getErnieTools(role, sections, isSuperAdmin),
                WEB_SEARCH_TOOL,
                WEB_FETCH_TOOL,
                { ...CODE_EXECUTION_TOOL, cache_control: { type: "ephemeral" } },
              ],
              ...(isLastRound ? { tool_choice: { type: "none" } } : {}),
              messages: withHistoryCacheBreakpoint(anthropicMessages),
            }),
          });

          if (!res.ok) {
            const detail = await res.text();
            throw new Error(`Ernie's backend returned an error (${res.status}): ${detail}`);
          }

          const data = await res.json();
          const content = data.content ?? [];

          // Anthropic's own hosted web_search tool shows up as a
          // "server_tool_use" block, already resolved within this same
          // response (no tool_result round-trip needed from us) — still
          // worth a status event since it's a real step Ernie just took.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
          if (content.some((b: any) => b.type === "server_tool_use" && b.name === "web_search")) {
            send({ type: "status", label: "Searching the web" });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
          if (content.some((b: any) => b.type === "server_tool_use" && b.name === "web_fetch")) {
            send({ type: "status", label: "Reading a webpage" });
          }
          if (
            content.some(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
              (b: any) =>
                b.type === "server_tool_use" &&
                (b.name === "bash_code_execution" || b.name === "text_editor_code_execution"),
            )
          ) {
            send({ type: "status", label: "Working in the sandbox" });
          }

          // Anthropic's server-side tools (web_fetch, code_execution) are
          // resolved within this same response regardless of whether this
          // round otherwise stops on tool_use or on a final text answer —
          // so this runs unconditionally, once per round, rather than only
          // inside the tool_use branch below. Per
          // claude/ernie-sandbox-restrictions.md: capture any file the
          // sandbox produced (the only way it can hand something back) and
          // log what actually ran (the "log of what ran" restriction) —
          // logging/capture failures are swallowed rather than breaking
          // Ernie's actual reply.
          for (const block of content) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            const b = block as any;
            if (b.type === "server_tool_use" && b.name === "web_fetch") {
              await logErnieToolExecution(supabase, user.id, conversationId, "web_fetch", {
                url: b.input?.url,
              });
            }
            if (b.type === "server_tool_use" && (b.name === "bash_code_execution" || b.name === "text_editor_code_execution")) {
              await logErnieToolExecution(supabase, user.id, conversationId, b.name, b.input ?? {});
            }
            if (b.type === "bash_code_execution_tool_result") {
              const result = b.content;
              const files = result?.type === "bash_code_execution_result" ? result.content ?? [] : [];
              for (const f of files) {
                if (!f?.file_id) continue;
                try {
                  const captured = await captureCodeExecutionFile(supabase, user.id, f.file_id);
                  outputFileIds.push(captured.id);
                  await logErnieToolExecution(supabase, user.id, conversationId, "code_execution_file_created", {
                    anthropic_file_id: f.file_id,
                    file_name: captured.file_name,
                  });
                } catch {
                  // A file the sandbox produced couldn't be captured —
                  // Ernie's text response still comes through; that one
                  // file just won't show up as a download chip.
                }
              }
            }
          }

          if (data.stop_reason === "tool_use") {
            anthropicMessages.push({ role: "assistant", content });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            const toolResults: any[] = [];
            // A tool result can carry real Anthropic content blocks (e.g. a
            // PDF "document" block from read_uploaded_file — see
            // lib/ernie/files.ts and lib/ernie/tools.ts) via a special
            // __contentBlocks key. A "document" block specifically is not
            // valid nested inside a tool_result block on Claude's Messages
            // API, so any such blocks are pulled out here and appended as
            // sibling blocks in the same user-role turn instead, alongside
            // the tool_results themselves.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            const extraSiblingBlocks: any[] = [];
            for (const block of content) {
              if (block.type !== "tool_use") continue;
              send({ type: "status", label: describeErnieToolLabel(block.name, block.input) });
              let result: unknown;
              try {
                // Out of time for this reply: don't start another tool (a
                // browser step can take up to 30s) — the next round is the
                // forced wrap-up answer.
                result = isReplyOutOfTime(replyStartedAt)
                  ? { error: "Out of time for this reply — stop here and answer with what you've found so far." }
                  : await runErnieTool(supabase, block.name, block.input ?? {}, role, sections, conversationId, isSuperAdmin, user.id, requestId);
              } catch (toolErr) {
                result = {
                  error:
                    toolErr instanceof Error ? toolErr.message : "Tool lookup failed",
                };
              }
              // edit_spreadsheet, get_file_for_download, and (added
              // 2026-09-09) export_pricing_data_as_spreadsheet all hand back
              // { id, file_name, ... } for a file now sitting in ernie_files
              // — capture that id so it can be surfaced as a download chip
              // instead of silently existing only in the database.
              if (
                (block.name === "edit_spreadsheet" ||
                  block.name === "get_file_for_download" ||
                  block.name === "export_pricing_data_as_spreadsheet" ||
                  block.name === "fetch_url_as_file" ||
                  block.name === "generate_image" ||
                  block.name === "edit_image") &&
                result &&
                typeof result === "object" &&
                "id" in result &&
                typeof (result as { id: unknown }).id === "string"
              ) {
                outputFileIds.push((result as { id: string }).id);
              }
              if (block.name === "animate_image") {
                const videoJob = result as { pending?: unknown; job_id?: unknown } | null;
                if (videoJob?.pending === true && typeof videoJob.job_id === "string") {
                  videoJobIds.push(videoJob.job_id);
                }
              }
              if (block.name === "browse_website") {
                await logBrowseStep(supabase, user.id, conversationId, block.input, result);
              }
              if (block.name === "fetch_url_as_file") {
                await logErnieToolExecution(supabase, user.id, conversationId, "fetch_url_as_file", {
                  url: (block.input as { url?: string } | undefined)?.url,
                  ok: !(result && typeof result === "object" && "error" in (result as Record<string, unknown>)),
                });
              }
              if (result && typeof result === "object" && "__contentBlocks" in result) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
                const blocks = (result as { __contentBlocks: any[] }).__contentBlocks ?? [];
                const documentBlocks = blocks.filter((b) => b?.type === "document");
                const otherBlocks = blocks.filter((b) => b?.type !== "document");
                extraSiblingBlocks.push(...documentBlocks);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: otherBlocks.length > 0 ? otherBlocks : "File contents attached below.",
                });
              } else {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify(result),
                });
              }
            }
            anthropicMessages.push({ role: "user", content: [...toolResults, ...extraSiblingBlocks] });
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
          const textThisRound = content
            .filter((b: any) => b.type === "text")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            .map((b: any) => b.text)
            .join("\n")
            .trim();

          // A round can end without stop_reason "tool_use" and still have
          // done something real but invisible — most commonly, the model
          // reached for the code sandbox (a server_tool_use resolved
          // above) instead of generate_image/edit_image for an image task,
          // which can never actually succeed (the sandbox has no internet
          // access, so it can't reach the image model) and often comes
          // back with no accompanying text. Previously this silently fell
          // through to the generic "I wasn't able to put together an
          // answer" message below with no way to tell what happened. Give
          // it one more explicit nudge instead of accepting silence as
          // "done," unless this was already the forced-text-only last
          // round (isLastRound) — that round is the actual final chance,
          // so if it comes back empty even after this, the generic
          // fallback below is still the right last resort.
          if (!textThisRound && !isLastRound) {
            anthropicMessages.push({ role: "assistant", content });
            anthropicMessages.push({
              role: "user",
              content:
                "That round didn't produce a text reply or a tool call. If this involves creating, editing, or extending an image, use generate_image or edit_image — never the code sandbox, which has no internet access and can never reach the image model. Otherwise, either call the right tool or give a plain-text answer now.",
            });
            continue;
          }

          finalText = textThisRound;
          break;
        }

        if (!finalText) {
          finalText =
            "I wasn't able to put together an answer for that — try rephrasing, or ask something more specific.";
        }

        const { error: insertAssistantErr } = await supabase.from("ernie_messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: finalText,
          file_ids: outputFileIds,
        });
        if (insertAssistantErr) throw insertAssistantErr;

        // Bump updated_at so this conversation sorts to the top of the
        // history list and is what gets restored by default next time.
        await supabase
          .from("ernie_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);

        send({ type: "done", text: finalText, conversationId, outputFileIds, videoJobIds });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Unexpected server error talking to Ernie",
        });
      } finally {
        // Ernie's browser only ever lives for one reply.
        await closeBrowseSession(requestId);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
