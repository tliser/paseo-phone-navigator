Workspace Organizer shows your Paseo workspaces as a Host, Project and Workspace tree, on the phone, desktop and web. A "Workspaces" row in the sidebar opens it and shows a red badge with the number of workspaces that need you (waiting for input, failed or flagged). Every workspace header gets two buttons, Workspaces (back to the tree) and Mark read, and the Command Center has a "Workspaces" entry.

## Read state and the Inbox

A chat stays unread until you mark it read, type in it or send it a prompt. Opening it alone does not mark it read; the plugin remembers Paseo's news flag. On web and desktop, putting the cursor in a chat's message field counts as typing; on phones, the keyboard opening while the chat is on screen does. Mark read in the header marks the open chat read; on a read chat it offers Mark unread. Swipe left and the row menu also mark read.

The Inbox lists top-level chats (sub-agents left out) that ask you, failed or are unread. An asking chat shows what it asks, and you can answer permissions (allow or deny, or the provider's own buttons) and single-choice questions there. A failed chat shows its last error. Hosts that are offline, loading or failing to load are named, and "All caught up" only shows when every host was checked. A workspace's state follows its top-level chats the same way. Each profile lays out the Inbox entries in one to three lines (Settings → Inbox): chat, catch-up or last reply, workspace, project, host, waiting since, state, model and branch. The workspace title shows only when its workspace has more than one chat and a different name.

Under each chat's message field are three pills: Inbox, with the count, opens the Inbox with Back and Forward through the chats you visited; Mark read (Mark unread on a read chat) marks the chat and becomes the other, and you stay on the chat (on phones the switch shows only after the chat screen redraws, a known issue); Catch up shows where the chat left off and what comes next, in two lines of at most 80 characters each. On web and desktop, Alt+← / Alt+→ and the mouse's back and forward buttons also step through visited chats.

## Catch-up

Catch up writes a new note unless the stored one is newer than the chat's last prompt and finished turn; "Again" writes one anyway. The chat's own host does the work: a hidden helper agent on the model chosen for that host (Settings → Inbox: a tab per host, provider then model, each from a searchable list; for every profile and device) reads the chat's last turns and is deleted afterwards. The note is stored on the chat, so every device and the Inbox show it; once the chat moves on, the Inbox shows the opening of the agent's last reply instead (no model involved, so it costs no tokens). The host stores that opening on the chat whenever a turn ends; reading it later would restart a closed agent. By default the catch-up also names the chat with a short topic, replacing Paseo's default name (the start of your first prompt). A name you gave the chat yourself is never replaced, and the switch "Name chats from the catch-up" turns renaming off. The chat's host must run this plugin.

## Rows

Each workspace row shows its status, title, diff size, branch, the model of its most recently active agent and when it was last active. Hosts, projects and workspaces can each be collapsed, and the tree remembers what you collapsed. On phones rows grow with the system text size. The header is one line: search, the attention count (tap to show only those), the All, Recent, Active or Inbox filter, expand or collapse everything, and the profile.

## Profiles

A profile holds the view settings: density, which details rows show, the default filter, how many days count as Recent, hiding finished workspaces after a day or a week, hidden hosts, pinned workspaces, and whether new hosts and projects start expanded. The settings screen previews the rows with the profile being edited. Phone (compact, Active) and Desktop (comfortable, All) come built in. Profiles are stored on the host that serves the plugin and shared by all its clients. Each device picks one: the one you chose last, otherwise the profile bound to your platform. Manage them under Settings, Plugins, Workspace Organizer.

On web and desktop the chosen profile and the collapse state are kept on the device. The phone apps have no storage for plugins, so there the collapse state is saved into the profile a few seconds after you change it, and the profile you pick lasts until the app restarts.

## Limits

- Needs Paseo 0.15 or later.
- It reads every connected host through the app's own connections. Offline hosts are shown dimmed.
- Phones cannot tell which field the keyboard is for, so the keyboard marks a chat read only while none of the plugin's own fields or screens is in use.
- The header buttons and composer pills appear on workspaces of hosts where this plugin is installed; the sidebar row and the Command Center work for all hosts.
- It only reads workspace and agent metadata. It does not read conversations or contact any outside service, and changes workspaces or answers agents only when you ask it to.
