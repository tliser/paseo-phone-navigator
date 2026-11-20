// The Inbox: every top-level chat that asks you, failed or is unread, on every host. An entry opens that chat.
// A chat that asks shows what it asks and can be answered right here: the permission's buttons (allow, deny,
// or the provider's own), or the options of a single question. Anything else opens the chat. A failed chat
// shows its last error. The same list sits in the title bar's sheet and in the composer's Inbox pill.
import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { shortenModel, timeAgo } from "../shared/format";
import type { Inbox, InboxEntry } from "../shared/inbox";
import type { InboxField } from "../shared/profiles";
import type { AgentRequest, RequestAction } from "../shared/types";
import { Mark, MARK_LABEL, markColor } from "./marks";
import type { PermissionResponse } from "./paseo";
import { getStore } from "./runtime";
import { Sheet, SheetDivider, SheetItem, SheetNote, type Anchor } from "./sheet";

/** Offline, loading and failing hosts, named so a short Inbox is never mistaken for an empty one. */
export function hostsNote(inbox: Inbox): string | null {
  const parts: string[] = [];
  const say = (labels: string[], what: string, rest: string) => {
    if (!labels.length) return;
    const one = labels.length === 1;
    parts.push(`${labels.join(", ")} ${one ? "is" : "are"} ${what}, so ${one ? "its" : "their"} chats ${rest}.`);
  };
  say(inbox.offlineHosts, "offline", "are not checked");
  say(inbox.loadingHosts, "loading", "are not checked yet");
  say(inbox.failedHosts, "failing to load", "may be missing");
  return parts.length ? parts.join(" ") : null;
}

/** "All caught up" only when every host was checked. */
export function inboxSummary(inbox: Inbox): string {
  if (inbox.entries.length) return `${inbox.entries.length} ${inbox.entries.length === 1 ? "chat" : "chats"} · questions and errors first`;
  return hostsNote(inbox) ? "Nothing waits for you on the hosts that were checked." : "All caught up. Nothing waits for you.";
}

/** The single question a chat asks, when it can be answered with one tap; null when the chat must be opened. */
function oneTapQuestion(request: AgentRequest) {
  const [question, ...more] = request.questions;
  return question && !more.length && !question.multiSelect && question.options.length ? question : null;
}

function RequestAnswers({ theme, entry, compact }: { theme: PluginTheme; entry: InboxEntry & { request: AgentRequest }; compact: boolean }) {
  const c = theme.colors;
  const { request } = entry;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const respond = (id: string, response: PermissionResponse) => {
    setBusy(id);
    setError(null);
    getStore()
      .respondToPermission(entry.serverId, entry.agentId, request.id, response)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(null);
      });
  };
  const question = oneTapQuestion(request);
  const choices: { id: string; label: string; tone: "primary" | "danger" | "plain"; run(): void }[] = question
    ? question.options.map((option, index) => ({
        id: `option-${index}`,
        label: option.label,
        tone: "plain" as const,
        run: () => respond(`option-${index}`, { behavior: "allow", updatedInput: { ...request.input, answers: { [question.header]: option.label } } }),
      }))
    : request.actions.map((action: RequestAction) => ({
        id: action.id,
        label: action.label,
        tone: action.variant === "danger" || action.behavior === "deny" ? ("danger" as const) : action.variant === "primary" ? ("primary" as const) : ("plain" as const),
        run: () =>
          respond(action.id, action.behavior === "allow" ? { behavior: "allow", selectedActionId: action.id } : { behavior: "deny", selectedActionId: action.id, message: "Denied by user" }),
      }));
  const text = question ? question.question : request.description;
  return (
    <View style={{ gap: 6, paddingLeft: 26 }}>
      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{question ? question.header : request.title}</Text>
      {text ? <Text numberOfLines={3} style={{ color: c.foregroundMuted, fontSize: 12.5, fontFamily: question ? undefined : "monospace" }}>{text}</Text> : null}
      {choices.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {choices.map((choice) => {
            const fill = choice.tone === "primary" ? c.accent : choice.tone === "danger" ? "transparent" : c.surface2;
            const ink = choice.tone === "primary" ? c.accentForeground : choice.tone === "danger" ? c.statusDanger : c.foreground;
            return (
              <Pressable
                key={choice.id}
                accessibilityRole="button"
                accessibilityLabel={`${choice.label}, answers ${entry.chatTitle}`}
                accessibilityState={{ disabled: busy !== null, busy: busy === choice.id }}
                disabled={busy !== null}
                onPress={choice.run}
                hitSlop={{ top: 4, bottom: 4 }}
                style={({ pressed }) => ({ minHeight: compact ? 40 : 32, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: choice.tone === "danger" ? 1 : 0, borderColor: c.statusDanger, backgroundColor: fill, opacity: busy !== null && busy !== choice.id ? 0.5 : pressed ? 0.8 : 1 })}
              >
                <Text style={{ color: ink, fontSize: 13, fontWeight: "600" }}>{busy === choice.id ? "Sending…" : choice.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={{ color: c.foregroundMuted, fontSize: 12, fontStyle: "italic" }}>Open the chat to answer.</Text>
      )}
      {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{`Could not answer: ${error}`}</Text> : null}
    </View>
  );
}

/** The text of one field, or "" when the entry has nothing for it (the field then stays hidden). */
function fieldText(field: InboxField, entry: InboxEntry, now: number, shown: ReadonlySet<InboxField>): string {
  switch (field) {
    case "chat":
      return entry.chatTitle;
    case "workspace":
      // With one chat, or the same name, the workspace title only repeats the chat's.
      return entry.workspaceChats > 1 && entry.workspaceTitle.trim().toLowerCase() !== entry.chatTitle.trim().toLowerCase() ? entry.workspaceTitle : "";
    case "project":
      return entry.projectName;
    case "host":
      return entry.hostLabel;
    case "time":
      return timeAgo(entry.at, now);
    case "state":
      return MARK_LABEL[entry.state];
    case "model":
      return shortenModel(entry.model);
    case "branch":
      return entry.branch ?? "";
    case "catchup":
      if (entry.catchUp) return `${entry.catchUp.left} → ${entry.catchUp.next}`;
      // No catch-up yet: what the entry is and where, unless another line already says it.
      return [shown.has("state") ? "" : MARK_LABEL[entry.state], shown.has("project") ? "" : entry.projectName].filter(Boolean).join(" · ");
  }
}

/** An entry's lines as the profile lays them out; the first line is the headline. */
function EntryLines({ theme, entry, lines, now }: { theme: PluginTheme; entry: InboxEntry; lines: readonly InboxField[][]; now: number }) {
  const c = theme.colors;
  const shown = new Set(lines.flat());
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {lines.map((fields, index) => {
        const parts = fields.map((field) => ({ field, text: fieldText(field, entry, now, shown) })).filter((part) => part.text);
        if (!parts.length) return null;
        const head = index === 0;
        const catchUp = fields.includes("catchup") && !!entry.catchUp;
        return (
          <Text
            key={index}
            numberOfLines={catchUp ? 2 : 1}
            style={{ color: head ? c.foreground : c.foregroundMuted, fontSize: head ? 14 : 12, ...(catchUp && entry.catchUpStale ? { fontStyle: "italic", opacity: 0.75 } : {}) }}
          >
            {parts.map((part, at) => (
              <Text key={part.field} style={part.field === "chat" ? { fontWeight: "700" } : part.field === "catchup" && entry.catchUp && !head ? { color: c.foreground } : undefined}>
                {at ? ` · ${part.text}` : part.text}
              </Text>
            ))}
          </Text>
        );
      })}
    </View>
  );
}

export function EntryRow({ theme, entry, lines, now, compact, onOpen }: { theme: PluginTheme; entry: InboxEntry; lines: readonly InboxField[][]; now: number; compact: boolean; onOpen(entry: InboxEntry): void }) {
  const c = theme.colors;
  const ago = timeAgo(entry.at, now);
  const where = `${entry.hostLabel} / ${entry.projectName}`;
  const tint = entry.state === "unread" ? "transparent" : `${markColor(theme, entry.state)}14`;
  const catchUp = entry.catchUp ? `. Catch-up${entry.catchUpStale ? ", older" : ""}: ${entry.catchUp.left}. Next: ${entry.catchUp.next}` : "";
  return (
    <View style={{ gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: tint }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entry.chatTitle} in ${entry.workspaceTitle}. ${MARK_LABEL[entry.state]}, ${where}${ago ? `, ${ago} ago` : ""}${catchUp}. Opens the chat`}
        onPress={() => onOpen(entry)}
        style={({ pressed }) => ({ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.7 : 1 })}
      >
        <Mark theme={theme} kind={entry.state} size={16} />
        <EntryLines theme={theme} entry={entry} lines={lines} now={now} />
      </Pressable>
      {entry.request ? <RequestAnswers key={entry.request.id} theme={theme} entry={entry as InboxEntry & { request: AgentRequest }} compact={compact} /> : null}
      {entry.errorText ? (
        <Text numberOfLines={3} style={{ paddingLeft: 26, color: c.statusDanger, fontSize: 12.5, fontFamily: "monospace" }}>{entry.errorText}</Text>
      ) : null}
    </View>
  );
}

/**
 * The entries, in their own scroll area. `hostScrolls`: the surface around already scrolls (Paseo's popover
 * for composer pills); a scroll area inside it would get no height of its own and take the swipes, so the
 * list could not scroll at all.
 */
export function InboxList({ theme, inbox, lines, now, compact, onOpen, hostScrolls = false }: { theme: PluginTheme; inbox: Inbox; lines: readonly InboxField[][]; now: number; compact: boolean; onOpen(entry: InboxEntry): void; hostScrolls?: boolean }) {
  if (!inbox.entries.length) return null;
  const rows = inbox.entries.map((entry) => <EntryRow key={`${entry.serverId}:${entry.agentId}`} theme={theme} entry={entry} lines={lines} now={now} compact={compact} onOpen={onOpen} />);
  if (hostScrolls) return <View style={{ gap: 4 }}>{rows}</View>;
  return (
    <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 4 }} keyboardShouldPersistTaps="handled">
      {rows}
    </ScrollView>
  );
}

export function InboxSheet({
  theme,
  compact,
  anchor,
  inbox,
  lines,
  now,
  onOpen,
  onMarkUnreadRead,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  anchor: Anchor | null;
  inbox: Inbox;
  lines: readonly InboxField[][];
  now: number;
  onOpen(entry: InboxEntry): void;
  onMarkUnreadRead(): void;
  onClose(): void;
}) {
  const unread = inbox.entries.filter((entry) => entry.state === "unread").length;
  const note = hostsNote(inbox);
  return (
    <Sheet theme={theme} title="Inbox" compact={compact} anchor={anchor} width={400} onClose={onClose}>
      <SheetNote theme={theme}>{inboxSummary(inbox)}</SheetNote>
      <InboxList theme={theme} inbox={inbox} lines={lines} now={now} compact={compact} onOpen={onOpen} />
      {note ? <SheetNote theme={theme}>{note}</SheetNote> : null}
      {unread ? (
        <>
          <SheetDivider theme={theme} />
          <SheetItem theme={theme} compact={compact} icon="CheckCheck" label={`Mark ${unread} unread as read`} onPress={onMarkUnreadRead} />
        </>
      ) : null}
    </Sheet>
  );
}
