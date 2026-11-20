import { describe, expect, it, vi } from "vitest";
import { createSyncedDoc } from "../client/synced-doc";

interface Doc {
  n: number;
}

/** A host settings document; reads answer with the copy at call time, and can be held back. */
function fakeHost() {
  const state = { revision: 1, values: { n: 0 } as Doc };
  const held: (() => void)[] = [];
  let hold = false;
  const rpc = async (contract: { name: string }, input: { revision?: string; values?: Doc }) => {
    if (contract.name.endsWith("read")) {
      const copy = { status: "ready", revision: String(state.revision), values: state.values };
      if (!hold) return copy;
      // The repo's TypeScript lib has no Promise.withResolvers.
      return new Promise<typeof copy>((resolve) => held.push(() => resolve(copy)));
    }
    if (input.revision !== String(state.revision)) return { status: "conflict" };
    state.revision++;
    state.values = input.values!;
    return { status: "saved", revision: String(state.revision), values: state.values };
  };
  return {
    state,
    rpc,
    holdReads: (on: boolean) => void (hold = on),
    releaseReads: () => held.splice(0).forEach((release) => release()),
  };
}

describe("createSyncedDoc", () => {
  it("a read that started before a save does not bring back the older copy", async () => {
    const host = fakeHost();
    const doc = createSyncedDoc<Doc>({ rpc: host.rpc as never, settingsId: "reads", label: "reads", normalize: (raw) => (raw as Doc) ?? { n: 0 }, changed: () => undefined });
    await doc.read();
    host.holdReads(true);
    const stale = doc.read(); // e.g. another device's change announced itself
    host.holdReads(false);
    doc.edit(() => ({ n: 1 })); // e.g. Mark read
    await vi.waitFor(() => expect(host.state.revision).toBe(2));
    host.releaseReads();
    await stale;
    await vi.waitFor(() => expect(doc.value()).toEqual({ n: 1 }));
  });
});
