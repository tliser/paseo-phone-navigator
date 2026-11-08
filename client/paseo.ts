import type { getPaseoClient } from "@getpaseo/plugin/client";

// SDK types derived from what the host provides. Importing "@getpaseo/client" or "@getpaseo/protocol"
// directly would break when Paseo builds a Git install without dev dependencies.

export type PaseoApi = ReturnType<typeof getPaseoClient>;
export type WorkspaceListResult = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>;
export type AgentListResult = Awaited<ReturnType<PaseoApi["agents"]["list"]>>;
export type PaseoWorkspace = WorkspaceListResult["entries"][number];
export type PaseoAgent = AgentListResult["entries"][number]["agent"];

type EventObservation = ReturnType<PaseoApi["observeEvents"]>;
export type ServerMessage = Parameters<Parameters<EventObservation["subscribe"]>[0]["update"]>[0];

export interface Released {
  release(): Promise<void>;
}
