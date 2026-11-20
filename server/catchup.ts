// Writes a chat's catch-up on the host that runs the chat: reads its latest turns, has a hidden helper
// agent on the model you picked summarise them, stores the result on the chat and, when asked, renames a
// chat that still has Paseo's default name. Runs here rather than in the app, so a phone that locks
// while the helper works still gets the result.
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { CATCH_UP_KEY, catchUpPrompt, hasDefaultTitle, parseCatchUp, readCatchUp, TRANSCRIPT_TURNS, transcriptOf, type CatchUp, type ChatMessage } from "../shared/catchup";
import { runCli } from "./cli";

type Paseo = PluginHandlerContext["paseo"];
/** The part of a timeline page read here; structural, so it follows the SDK's item union without naming it. */
interface TimelinePage {
  entries: readonly { item: { type: string; text?: string } }[];
}

const HELPER_TIMEOUT_MS = 120_000;

function messagesOf(page: TimelinePage): ChatMessage[] {
  return page.entries.flatMap(({ item }): ChatMessage[] =>
    item.type === "user_message" ? [{ role: "user", text: item.text ?? "" }] : item.type === "assistant_message" ? [{ role: "agent", text: item.text ?? "" }] : [],
  );
}

/** One run per chat at a time: a second press while one runs gets the same result. */
const running = new Map<string, Promise<{ catchUp: CatchUp; renamed: boolean }>>();

export function generateCatchUp(paseo: Paseo, input: { agentId: string; model: string; rename: boolean }) {
  const pending = running.get(input.agentId);
  if (pending) return pending;
  const run = write(paseo, input).finally(() => running.delete(input.agentId));
  running.set(input.agentId, run);
  return run;
}

async function write(paseo: Paseo, { agentId, model, rename }: { agentId: string; model: string; rename: boolean }) {
  const chat = paseo.agents.ref(agentId);
  const latest = await chat.timeline.refetch({ direction: "tail", limit: TRANSCRIPT_TURNS, wholeTurns: true, projection: "projected" });
  if (latest.error) throw new Error(latest.error);
  const transcript = transcriptOf(messagesOf(latest));
  if (!transcript) throw new Error("Nothing to catch up on yet");
  const snapshot = latest.agent ?? (await chat.refresh())?.agent ?? null;
  if (!snapshot) throw new Error("This chat is gone");

  // A hidden helper in the chat's own folder, so no new project appears. Deleted afterwards, whatever happened.
  const helper = await paseo.agents.create({
    cwd: snapshot.cwd,
    config: { provider: model },
    title: "Catch-up",
    background: true,
    labels: { "workspace-organizer": "catch-up" },
    prompt: catchUpPrompt(transcript),
  });
  let answer: string;
  try {
    const result = await helper.waitForFinish(HELPER_TIMEOUT_MS);
    if (result.status !== "idle") throw new Error(result.error ?? (result.status === "timeout" ? "The model took too long" : `The model stopped (${result.status})`));
    answer = result.lastMessage ?? "";
  } finally {
    await runCli(["delete", helper.id]).catch((error: unknown) => console.error("Workspace Organizer: deleting the catch-up helper failed", error));
  }
  const catchUp = parseCatchUp(answer, Date.now());
  if (!catchUp) throw new Error(`The model did not answer in the expected format: ${answer.slice(0, 200)}`);

  let renamed = false;
  if (rename && catchUp.title !== snapshot.title?.trim()) {
    const previous = readCatchUp(snapshot.metadata);
    // Paseo names a chat after the start of its first prompt; only the timeline still has that prompt.
    const first = latest.hasOlder
      ? await chat.timeline.refetch({ direction: "after", cursor: { epoch: latest.epoch, seq: 0 }, limit: 3, projection: "canonical" })
      : latest;
    const firstPrompt = messagesOf(first).find((message) => message.role === "user")?.text ?? null;
    if (hasDefaultTitle(snapshot.title, firstPrompt, previous)) {
      await runCli(["agent", "update", agentId, "--name", catchUp.title]);
      renamed = true;
    }
  }
  await chat.setMetadata({ [CATCH_UP_KEY]: catchUp });
  return { catchUp, renamed };
}
