// Typing in a chat marks it read, and stepping back and forth through visited chats.
// - Web and desktop: typing in a chat's message field marks that chat read. Focus alone does not count:
//   Paseo puts the cursor there itself when a chat opens on desktop. The field sits in Paseo's composer
//   ("message-input-root"); the chat is named by the marker the Inbox pill's icon renders in that composer,
//   else the chat on screen. Alt+← / Alt+→ (outside text fields) and the mouse's back and forward buttons
//   step through the chats you visited.
// - Phones (no DOM): the keyboard opening while a chat is on screen marks that chat read, unless one of the
//   plugin's own fields or screens is in use (Paseo does not say which field the keyboard is for).
import { Keyboard, Platform } from "react-native";
import { historyStep, ownInputActive, splitChatKey, travelTo, type ChatKey } from "./chat-nav";
import { markOpenChatRead } from "./composer-pills";
import { openChat } from "./runtime";

interface DomElement {
  closest(selector: string): DomElement | null;
  querySelector(selector: string): DomElement | null;
  getAttribute(name: string): string | null;
  parentElement: DomElement | null;
}
interface DomEvent {
  target: unknown;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  key?: string;
  button?: number;
  preventDefault(): void;
}
declare const document: { addEventListener(type: string, listener: (event: DomEvent) => void, capture?: boolean): void; removeEventListener(type: string, listener: (event: DomEvent) => void, capture?: boolean): void };

const MARKER = '[data-testid^="wo-chat:"]';

/**
 * Each host runs its own copy of the plugin; only the first registered copy listens, or a key would step
 * twice. When it unloads, the next registered copy starts its listeners. Shared on globalThis.
 */
const CLAIM = "__workspaceOrganizer.chatInput.v2";
type Start = () => () => void;
interface Claim {
  copies: Start[];
  stop: (() => void) | null;
}

/**
 * The chat of a message field: the nearest Inbox pill marker around it. Only a few levels up, so another
 * chat's composer elsewhere on the page is never taken for this one (the chat on screen is used instead).
 */
function chatOfField(field: DomElement): ChatKey | null {
  let at: DomElement | null = field;
  for (let level = 0; at && level < 8; level++, at = at.parentElement) {
    const marker = at.querySelector(MARKER);
    if (marker) return marker.getAttribute("data-testid")?.slice("wo-chat:".length) ?? null;
  }
  return null;
}

const isElement = (value: unknown): value is DomElement => typeof value === "object" && value !== null && "closest" in value;

/** Arrow keys there move the cursor, so they never step through chats. */
function isTextField(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("isContentEditable" in value && value.isContentEditable === true) return true;
  return "tagName" in value && (value.tagName === "INPUT" || value.tagName === "TEXTAREA");
}

function step(by: -1 | 1): boolean {
  const key = historyStep(by);
  if (!key) return false;
  travelTo(key);
  const { serverId, agentId } = splitChatKey(key);
  openChat(serverId, agentId);
  return true;
}

function startNative(): () => void {
  const subscription = Keyboard.addListener("keyboardDidShow", () => {
    if (!ownInputActive()) markOpenChatRead();
  });
  return () => subscription.remove();
}

function startWeb(): () => void {
  const onInput = (event: DomEvent) => {
    if (!isElement(event.target)) return;
    const root = event.target.closest('[data-testid="message-input-root"]');
    if (root) markOpenChatRead(chatOfField(root) ?? undefined);
  };
  const onKey = (event: DomEvent) => {
    if (!event.altKey || event.shiftKey || event.metaKey || event.ctrlKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    if (isTextField(event.target)) return;
    if (step(event.key === "ArrowLeft" ? -1 : 1)) event.preventDefault();
  };
  // Buttons 3 and 4 are the mouse's back and forward.
  const onMouse = (event: DomEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    if (step(event.button === 3 ? -1 : 1)) event.preventDefault();
  };
  document.addEventListener("beforeinput", onInput, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mouseup", onMouse, true);
  return () => {
    document.removeEventListener("beforeinput", onInput, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mouseup", onMouse, true);
  };
}

export function listenForChatInput(): () => void {
  if (Platform.OS === "web" && typeof document === "undefined") return () => undefined;
  // A fresh function per copy, so the claim can tell copies apart.
  const own: Start = () => (Platform.OS === "web" ? startWeb() : startNative());
  const holder = globalThis as unknown as Record<string, Claim | undefined>;
  const claim = (holder[CLAIM] ??= { copies: [], stop: null });
  claim.copies.push(own);
  if (claim.copies.length === 1) claim.stop = own();
  return () => {
    const held = claim.copies[0] === own;
    claim.copies = claim.copies.filter((copy) => copy !== own);
    if (!held) return;
    claim.stop?.();
    claim.stop = claim.copies[0]?.() ?? null;
  };
}
