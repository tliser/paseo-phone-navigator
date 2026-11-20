// The Inbox pill's popup: the sections the profile picks (Settings → Inbox), each a few chats with "Show all";
// the settings preview draws it with sample entries. And the picker for those sections.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { InboxEntry } from "../shared/inbox";
import { normalizeSections, POPUP_SECTIONS, type InboxField, type PopupSection } from "../shared/profiles";
import { EntryRow } from "./inbox-sheet";

export const POPUP_SECTION_LABEL: Record<PopupSection, string> = { inbox: "Inbox", pinned: "Pinned", recent: "Recent", active: "Active", running: "Running" };
export const POPUP_SECTION_HINT: Record<PopupSection, string> = {
  inbox: "Chats that ask you, failed or are unread, on every host.",
  pinned: "The latest chat of each pinned workspace.",
  recent: "The latest chat of each workspace in the Recent view.",
  active: "The latest chat of each workspace that runs, is unread or needs you.",
  running: "Chats working right now.",
};
const EMPTY: Record<PopupSection, string> = { inbox: "All caught up. Nothing waits for you.", pinned: "Nothing pinned.", recent: "Nothing recent.", active: "Nothing running, unread or asking.", running: "Nothing running." };
/** Entries a section shows before "Show all". */
const SHOWN = 3;

export interface PopupSectionList {
  section: PopupSection;
  entries: readonly InboxEntry[];
  /** Instead of the default text when the section is empty. */
  empty?: string;
  /** Below the entries, e.g. hosts that were not checked. */
  note?: string | null;
}

function Section({ theme, list, lines, now, compact, onOpen }: { theme: PluginTheme; list: PopupSectionList; lines: readonly InboxField[][]; now: number; compact: boolean; onOpen(entry: InboxEntry): void }) {
  const c = theme.colors;
  const [all, setAll] = useState(false);
  const { section, entries } = list;
  const shown = all ? entries : entries.slice(0, SHOWN);
  return (
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "700" }}>
        {entries.length ? `${POPUP_SECTION_LABEL[section]} · ${entries.length}` : POPUP_SECTION_LABEL[section]}
      </Text>
      {entries.length ? null : <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{list.empty ?? EMPTY[section]}</Text>}
      {shown.map((entry) => (
        <EntryRow key={`${entry.serverId}:${entry.agentId}`} theme={theme} entry={entry} lines={lines} now={now} compact={compact} onOpen={onOpen} />
      ))}
      {entries.length > SHOWN ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(!all)} hitSlop={{ top: 6, bottom: 6 }} style={{ alignSelf: "flex-start", paddingHorizontal: 10 }}>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>{all ? "Show fewer" : `Show all ${entries.length}`}</Text>
        </Pressable>
      ) : null}
      {list.note ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{list.note}</Text> : null}
    </View>
  );
}

/** Paseo's popover surface scrolls itself: no scroll area of our own here. */
export function PopupSections({ theme, lists, lines, now, compact, onOpen }: { theme: PluginTheme; lists: readonly PopupSectionList[]; lines: readonly InboxField[][]; now: number; compact: boolean; onOpen(entry: InboxEntry): void }) {
  return (
    <View style={{ gap: 14 }}>
      {lists.map((list) => (
        <Section key={list.section} theme={theme} list={list} lines={lines} now={now} compact={compact} onOpen={onOpen} />
      ))}
    </View>
  );
}

/** Turn sections on or off and move the ones shown up or down; at least one stays on. */
export function SectionPicker({ theme, sections, disabled, onChange }: { theme: PluginTheme; sections: readonly PopupSection[]; disabled: boolean; onChange(sections: PopupSection[]): void }) {
  const c = theme.colors;
  const rows = [...sections, ...POPUP_SECTIONS.filter((section) => !sections.includes(section))];
  const move = (at: number, by: -1 | 1) => {
    const next = [...sections];
    [next[at], next[at + by]] = [next[at + by]!, next[at]!];
    onChange(next);
  };
  const arrow = (name: "ChevronUp" | "ChevronDown", label: string, enabled: boolean, press: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={press} hitSlop={6} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", opacity: enabled ? 1 : 0.3 }}>
      <Icon name={name} size={18} color={c.foreground} />
    </Pressable>
  );
  return (
    <View>
      {rows.map((section) => {
        const at = sections.indexOf(section);
        const on = at >= 0;
        const label = POPUP_SECTION_LABEL[section];
        const lone = on && sections.length === 1;
        return (
          <View key={section} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: section === rows[0] ? 0 : 1, borderTopColor: c.border }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={label}
              accessibilityHint={lone ? "The popup needs at least one section." : POPUP_SECTION_HINT[section]}
              accessibilityState={{ checked: on, disabled: disabled || lone }}
              disabled={disabled || lone}
              onPress={() => onChange(normalizeSections(on ? sections.filter((entry) => entry !== section) : [...sections, section]))}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: on ? c.accent : c.foregroundMuted, backgroundColor: on ? c.accent : "transparent", alignItems: "center", justifyContent: "center", opacity: lone ? 0.5 : 1 }}>
                {on ? <Icon name="Check" size={14} color={c.accentForeground} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.foreground, fontSize: 14 }}>{label}</Text>
                <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{POPUP_SECTION_HINT[section]}</Text>
              </View>
            </Pressable>
            {on ? (
              <>
                {arrow("ChevronUp", `Move ${label} up`, !disabled && at > 0, () => move(at, -1))}
                {arrow("ChevronDown", `Move ${label} down`, !disabled && at < sections.length - 1, () => move(at, 1))}
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
