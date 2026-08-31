import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getErnieTools, buildErnieSystemPrompt, runErnieTool, describeErnieToolCall } from "@/lib/ernie/tools";

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
// message it wants to ask, plus which conversation it belongs to (omitted
// to start a new one). This route loads that conversation's prior messages
// itself, runs the same tool-use back-and-forth with Claude's API as
// before, and persists both the new user message and Ernie's reply before
// responding. That's what lets a conversation survive navigating away from
// /ernie and back, a page refresh, or opening it from a different device —
// previously the full history only ever lived in the browser tab's memory.
//
// Streams progress as Server-Sent Events rather than a single JSON
// response, so the client can show a live "Checking inventory &
// allocations…" style status while Ernie works through its tool-use loop
// instead of one opaque "thinking" spinner (Chad's request, 2026-08-31).
// Only the final answer is ever persisted to ernie_messages — the
// intermediate status events are never saved, purely a live UI thing.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 8;

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

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
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
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role === "admin";

  const body = (await req.json()) as { conversationId?: string; message?: string };
  const newMessageText = body.message?.trim();

  if (!newMessageText) {
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
            .select("id")
            .eq("id", conversationId)
            .maybeSingle();
          if (convErr) throw convErr;

          if (!existing) {
            // Stale/invalid id (e.g. leftover in another browser's
            // sessionStorage, or the conversation was removed) — fall back
            // to starting a fresh conversation instead of erroring out.
            conversationId = undefined;
          } else {
            const { data: history, error: histErr } = await supabase
              .from("ernie_messages")
              .select("role, content")
              .eq("conversation_id", conversationId)
              .order("created_at", { ascending: true });
            if (histErr) throw histErr;
            priorMessages = (history ?? []).map((m) => ({
              role: m.role as "user" | "assistant",
              text: m.content,
            }));
          }
        }

        if (!conversationId) {
          const { data: created, error: createErr } = await supabase
            .from("ernie_conversations")
            .insert({ user_id: user.id, title: titleFromMessage(newMessageText) })
            .select("id")
            .single();
          if (createErr) throw createErr;
          conversationId = created.id;
        }

        const { error: insertUserErr } = await supabase.from("ernie_messages").insert({
          conversation_id: conversationId,
          role: "user",
          content: newMessageText,
        });
        if (insertUserErr) throw insertUserErr;

        const allMessages: ChatMessage[] = [...priorMessages, { role: "user", text: newMessageText }];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic message content shape varies (string vs. content blocks) across the tool-use loop
        const anthropicMessages: any[] = allMessages.map((m) => ({
          role: m.role,
          content: m.text,
        }));

        let finalText = "";

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
              system: buildErnieSystemPrompt(isAdmin),
              tools: [...getErnieTools(isAdmin), WEB_SEARCH_TOOL],
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

          // Anthropic's own hosted web_search tool shows up as a
          // "server_tool_use" block, already resolved within this same
          // response (no tool_result round-trip needed from us) — still
          // worth a status event since it's a real step Ernie just took.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
          if (content.some((b: any) => b.type === "server_tool_use" && b.name === "web_search")) {
            send({ type: "status", label: "Searching the web" });
          }

          if (data.stop_reason === "tool_use") {
            anthropicMessages.push({ role: "assistant", content });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            const toolResults: any[] = [];
            for (const block of content) {
              if (block.type !== "tool_use") continue;
              send({ type: "status", label: describeErnieToolCall(block.name) });
              let result: unknown;
              try {
                result = await runErnieTool(supabase, block.name, block.input ?? {}, isAdmin, conversationId);
              } catch (toolErr) {
                result = {
                  error:
                    toolErr instanceof Error ? toolErr.message : "Tool lookup failed",
                };
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result),
              });
            }
            anthropicMessages.push({ role: "user", content: toolResults });
            continue;
          }

          finalText = content
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            .filter((b: any) => b.type === "text")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
            .map((b: any) => b.text)
            .join("\n")
            .trim();
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
        });
        if (insertAssistantErr) throw insertAssistantErr;

        // Bump updated_at so this conversation sorts to the top of the
        // history list and is what gets restored by default next time.
        await supabase
          .from("ernie_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);

        send({ type: "done", text: finalText, conversationId });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Unexpected server error talking to Ernie",
        });
      } finally {
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
