// The row's lines as you see them: each line is a strip of value chips in their order. Tap a chip to
// select it, then move it within or between lines or remove it; "+" on a line adds a value that is not
// shown yet; "Add line" starts a new line (up to three). The title can move but never be removed.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MAX_LINES, normalizeLines, ROW_FIELDS, type RowField } from "../shared/profiles";

const FIELD_LABEL: Record<RowField, string> = { title: "Title", time: "Last activity", branch: "Branch", model: "Model", diff: "Changes", reason: "Why it needs you", project: "Project", host: "Host" };

/** Where `field` sits: line and position, or null when it is not shown. */
function find(lines: readonly RowField[][], field: RowField): { line: number; at: number } | null {
  for (const [line, fields] of lines.entries()) {
    const at = fields.indexOf(field);
    if (at !== -1) return { line, at };
  }
  return null;
}

/** Takes `field` out and puts it on `line` at `at` (end when omitted); one past the last line adds a line. */
function place(lines: readonly RowField[][], field: RowField, line: number, at?: number): RowField[][] {
  const next = lines.map((fields) => fields.filter((name) => name !== field));
  if (line >= next.length) next.push([field]);
  else next[line]!.splice(at ?? next[line]!.length, 0, field);
  return normalizeLines(next);
}

export function LineEditor({ theme, lines, disabled, onChange }: { theme: PluginTheme; lines: RowField[][]; disabled: boolean; onChange(lines: RowField[][]): void }) {
  const c = theme.colors;
  const [selected, setSelected] = useState<RowField | null>(null);
  /** The line whose "+" list is open, or `lines.length` for a new line. */
  const [adding, setAdding] = useState<number | null>(null);
  const unused = ROW_FIELDS.filter((field) => !find(lines, field));
  const where = selected ? find(lines, selected) : null;
  const change = (next: RowField[][]) => {
    onChange(next);
    setAdding(null);
  };

  const chip = (field: RowField) => {
    const on = selected === field;
    return (
      <Pressable
        key={field}
        accessibilityRole="button"
        accessibilityState={{ selected: on, disabled }}
        accessibilityLabel={`${FIELD_LABEL[field]}${on ? ", selected" : ""}`}
        accessibilityHint="Select to move or remove"
        disabled={disabled}
        onPress={() => {
          setAdding(null);
          setSelected(on ? null : field);
        }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={{ minHeight: 34, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: 1.5, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.surface2 : c.surface0 }}
      >
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: field === "title" ? "700" : "500" }}>{FIELD_LABEL[field]}</Text>
      </Pressable>
    );
  };
  const plus = (line: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: adding === line, disabled }}
      disabled={disabled}
      onPress={() => {
        setSelected(null);
        setAdding(adding === line ? null : line);
      }}
      hitSlop={{ top: 4, bottom: 4 }}
      style={{ minHeight: 34, minWidth: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: adding === line ? c.accent : c.border }}
    >
      <Icon name="Plus" size={14} color={c.foregroundMuted} />
      {line === lines.length ? <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Add line</Text> : null}
    </Pressable>
  );
  const picker = (line: number) =>
    adding === line ? (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 8 }}>
        {unused.map((field) => (
          <Pressable
            key={field}
            accessibilityRole="button"
            accessibilityLabel={`Add ${FIELD_LABEL[field]} to line ${line + 1}`}
            onPress={() => change(place(lines, field, line))}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.surface2 }}
          >
            <Icon name="Plus" size={12} color={c.accent} />
            <Text style={{ color: c.foreground, fontSize: 13 }}>{FIELD_LABEL[field]}</Text>
          </Pressable>
        ))}
      </View>
    ) : null;

  const action = (icon: string, label: string, enabled: boolean, run: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={run}
      style={{ width: 44, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, opacity: enabled ? 1 : 0.3 }}
    >
      <Icon name={icon} size={18} color={c.foreground} />
    </Pressable>
  );

  return (
    <View style={{ gap: 10 }}>
      {lines.map((fields, line) => (
        <View key={line} style={{ gap: 6 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{`Line ${line + 1}`}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            {fields.map(chip)}
            {unused.length ? plus(line, `Add a value to line ${line + 1}`) : null}
          </View>
          {picker(line)}
        </View>
      ))}
      {lines.length < MAX_LINES && unused.length ? (
        <View>
          <View style={{ flexDirection: "row" }}>{plus(lines.length, "Add a line")}</View>
          {picker(lines.length)}
        </View>
      ) : null}
      {selected && where ? (
        // Moves for the selected value; it stays selected so it can be moved again.
        <View accessibilityRole="toolbar" style={{ flexDirection: "row", alignItems: "center", gap: 2, padding: 4, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
          <Text numberOfLines={1} style={{ flex: 1, paddingLeft: 8, color: c.foreground, fontSize: 13, fontWeight: "600" }}>{FIELD_LABEL[selected]}</Text>
          {action("ArrowLeft", "Move earlier", where.at > 0, () => change(place(lines, selected, where.line, where.at - 1)))}
          {action("ArrowRight", "Move later", where.at < lines[where.line]!.length - 1, () => change(place(lines, selected, where.line, where.at + 1)))}
          {action("ArrowUp", "Move to the line above", where.line > 0, () => change(place(lines, selected, where.line - 1)))}
          {action("ArrowDown", "Move to the line below", where.line < lines.length - 1 || (lines.length < MAX_LINES && lines[where.line]!.length > 1), () => change(place(lines, selected, where.line + 1)))}
          {action("Trash2", "Remove from the row", selected !== "title", () => {
            change(normalizeLines(lines.map((fields) => fields.filter((name) => name !== selected))));
            setSelected(null);
          })}
        </View>
      ) : (
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Tap a value to move or remove it. Values without data stay hidden on that row.</Text>
      )}
    </View>
  );
}
