import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

type ReminderStatus = "pending" | "done";

interface ReminderItem {
  id: string;
  title: string;
  dueAt: string;
  notes?: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
}

type ReminderAgentActionType =
  | "create_reminder"
  | "list_reminders"
  | "mark_done"
  | "delete_reminder"
  | "reschedule_reminder"
  | "unknown";

interface ReminderAgentAction {
  type: ReminderAgentActionType;
  title?: string;
  dueAt?: string;
  notes?: string;
  targetTitle?: string;
  targetId?: string;
  scope?: "today" | "tomorrow" | "missed" | "done" | "pending" | "all";
}

interface ReminderAgentResponse {
  reply: string;
  action: ReminderAgentAction;
}

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";
const systemPrompt = `You are Personal Life OS reminder assistant.
Output ONLY valid JSON.
{
  "reply":"short response",
  "action":{
    "type":"create_reminder|list_reminders|mark_done|delete_reminder|reschedule_reminder|unknown",
    "title":"optional",
    "dueAt":"optional ISO string",
    "notes":"optional",
    "targetTitle":"optional",
    "targetId":"optional",
    "scope":"today|tomorrow|missed|done|pending|all optional"
  }
}`;

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output.");
  }
  return text.slice(start, end + 1);
}

function safeAgentResponse(text: string): ReminderAgentResponse {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as ReminderAgentResponse;
    if (!parsed?.action?.type || !parsed?.reply) {
      throw new Error("Invalid response shape.");
    }
    return parsed;
  } catch {
    return {
      reply: text.trim() || "I could not understand that request.",
      action: { type: "unknown" },
    };
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    message?: string;
    reminders?: ReminderItem[];
  };
  const message = body.message?.trim();
  const reminders = body.reminders ?? [];
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const nimApiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!nimApiKey) {
    const fallback: ReminderAgentResponse = {
      reply:
        "AI key is missing. I can still help with manual reminder form actions.",
      action: { type: "unknown" },
    };
    return NextResponse.json(fallback);
  }

  try {
    const model = process.env.NVIDIA_NIM_MODEL ?? DEFAULT_MODEL;
    const nimResponse = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nimApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `User message: ${message}\nCurrent reminders JSON:\n${JSON.stringify(
              reminders
            )}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!nimResponse.ok) {
      const errorText = await nimResponse.text();
      return NextResponse.json({
        reply: `AI request failed: ${errorText}`,
        action: { type: "unknown" },
      });
    }

    const data = (await nimResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    return NextResponse.json(safeAgentResponse(content));
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unexpected chat error.";
    return NextResponse.json({
      reply: `AI request failed: ${errorMessage}`,
      action: { type: "unknown" },
    });
  }
}
