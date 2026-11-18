// Entity refs for the sidebar view's navigation (Paseo 0.16). Same shape and key as the app's own
// createEntityRefs: key = JSON.stringify([hostId, id]).
import type { AgentRef, TerminalRef, WorkspaceRef } from "@getpaseo/plugin/client";

export const workspaceRef = (hostId: string, id: string): WorkspaceRef => Object.freeze({ kind: "workspace", key: JSON.stringify([hostId, id]), hostId, id });
export const agentRef = (hostId: string, id: string): AgentRef => Object.freeze({ kind: "agent", key: JSON.stringify([hostId, id]), hostId, id });
export const terminalRef = (hostId: string, id: string): TerminalRef => Object.freeze({ kind: "terminal", key: JSON.stringify([hostId, id]), hostId, id });
