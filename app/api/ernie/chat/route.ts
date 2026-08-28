import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ERNIE_TOOLS, ERNIE_SYSTEM_PROMPT, runErnieTool } from "@/lib/ernie/tools";

// Ernie's chat backend. Admin-only, read-only: this route calls Claude's
// Messages API directly (Ernie's underlying model — never surfaced to the
// user) with a fixed set of read-only data tools (lib/ernie/tools.ts) it can
// call to look up real app data. No tool here can write to the database.
//
// The client sends the full message history each request (plain
// {role, text} pairs) and gets back Ernie's final text reply — the
// tool-use back-and-forth with Claude's API happens entirely inside this
// one request and is never sent back to the browser.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 6;

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export async function POST(req: NextRequest) {
  try {
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

    if (profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Ernie is only available to admins" },
        { status: 403 },
      );
    }

    const { messages } = (await req.json()) as { messages: ChatMessage[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic message content shape varies (string vs. content blocks) across the tool-use loop
    const anthropicMessages: any[] = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    let finalText = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 2048,
          system: ERNIE_SYSTEM_PROMPT,
          tools: ERNIE_TOOLS,
          messages: anthropicMessages,
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Ernie's backend returned an error (${res.status}): ${detail}`);
      }

      const data = await res.json();
      const content = data.content ?? [];

      if (data.stop_reason === "tool_use") {
        anthropicMessages.push({ role: "assistant", content });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
        const toolResults: any[] = [];
        for (const block of content) {
          if (block.type !== "tool_use") continue;
          let result: unknown;
          try {
            result = await runErnieTool(supabase, block.name, block.input ?? {});
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

    return NextResponse.json({ text: finalText });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Unexpected server error talking to Ernie",
      },
      { status: 500 },
    );
  }
}
