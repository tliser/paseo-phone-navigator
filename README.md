# Phone Navigator for Paseo

A Host → Project → Workspace tree for [Paseo](https://paseo.sh), built for the mobile apps but usable on desktop and web too. It shows every workspace on every connected host in one place, with what needs you on top.

<p>
  <img src="docs/screenshots/phone-active.png" width="230" alt="Active filter on the phone">
  <img src="docs/screenshots/phone-inbox.png" width="230" alt="Inbox: asking you and unread">
  <img src="docs/screenshots/phone-drag.png" width="230" alt="Manual ordering by long-press drag">
</p>

## Features

- **One tree for all hosts.** Hosts, projects and workspaces can each be collapsed, and the tree remembers what you collapsed. Offline hosts are shown dimmed. Folded groups count what asks you, failed or is unread.
- **Inbox.** The title bar shows how many chats wait for you, how many ask you and how many failed. Tapping it opens the Inbox: one entry per chat that asks you, failed or is unread, on every host (hidden hosts too), questions and errors first. An entry opens that chat; "Mark N unread as read" can be undone.
- **Read state per chat.** Opening a chat does not mark it read. Press **Done** in the chat header to mark it read, or **Put back in Inbox** to make it unread again. Questions and errors stay until you answer or fix them. Read state is synced across devices.
- **Workspace rows.** Each row shows a status glyph (a shape per status, not only a colour), the title and one line: why it needs you ("Asks you · Payment states"), or the branch, model and changes in the order you choose. On the right: last activity and one mark per tab. Tap the marks to list the tabs (chats and terminals); a chat with sub-agents folds them under it.
- **Views and search.** All, Recent, Active and Pinned, each with a count. Search covers titles, branches, projects, hosts, models and tab titles; a row found through a tab says which.
- **Actions.** Hold a row (or use ⋯ / right-click on desktop) for pin, mark read, rename, move and archive; holding a tab adds "Mark … read" for it. Holding a project's name opens its sheet (new workspace, move, folder colour). Archiving keeps the row dimmed until the host has archived it.
- **New workspace.** The **+** on a project row opens a draft, like Paseo's own New workspace screen: choose a new worktree (optional branch name) or the project folder, then an agent with model, mode, the agent's on/off options such as *Auto Accept*, and a first message, or a terminal. Nothing is created until you tap *Create*.
- **Stable order.** Projects and workspaces are sorted by when you last prompted them (or created them), newest first. Agent output and status never move a row; the Inbox and the marks show what needs you. For your own order, set a profile's *Order* to *Manual*, then drag rows by their grip. On phones, Options → *Arrange order…* shows the grips. Projects reorder within their host and workspaces within their project.
- **Profiles.** Phone and Desktop come built in, and you can add your own. A profile holds the density, the view it opens on, what Recent means, the row layout, order, pins, hidden hosts and the collapse state. The settings screen shows a live preview of sample rows as you change a profile.
- **Entry points.** A "Workspaces" row in the sidebar, a sidebar view (Paseo 0.16), header buttons on every workspace (Done and Workspaces), and a Command Center entry.

The screenshots below show the previous version.

| Desktop | Settings | Profiles | Search |
| --- | --- | --- | --- |
| <img src="docs/screenshots/desktop.png" width="260"> | <img src="docs/screenshots/settings.png" width="200"> | <img src="docs/screenshots/phone-profiles.png" width="160"> | <img src="docs/screenshots/phone-search.png" width="160"> |

| All, with a pin | Row actions | New workspace |
| --- | --- | --- |
| <img src="docs/screenshots/phone-all.png" width="200"> | <img src="docs/screenshots/phone-row-menu.png" width="200"> | <img src="docs/screenshots/phone-new-workspace.png" width="200"> |

See [OVERVIEW.md](OVERVIEW.md) for more detail.

## Install

Requires Paseo 0.15 or later. The repository is private, so you need read access to it, and `git` on the daemon host must be able to clone from GitHub.

```bash
paseo plugin install git:tliser/paseo-phone-navigator
paseo plugin ls                       # phone-navigator should be "running"
paseo plugin logs phone-navigator     # "Plugin ready"
```

Then open the sidebar on any client and tap **Workspaces**. You can configure profiles under **Settings → Plugins → Phone Navigator**.

To update, run the install command again (or `paseo plugin reload phone-navigator` for a local checkout).

### Tips

- On the phone the header button may sit behind the "⋯" menu, because Paseo shows only one plugin button inline on narrow screens. The sidebar row always works.
- Drag only works when the active profile's *Order* is *Manual* and the search box is empty.

## Privacy

The plugin only reads workspace and agent metadata through the app's existing host connections. It does not read conversations, change workspaces, or contact any outside service.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin install /path/to/checkout     # local install
paseo plugin reload phone-navigator         # after changes
```

Layout:

- `index.client.tsx` / `index.server.ts`: plugin entry points (screens, sidebar item, header button, command, settings).
- `shared/`: pure logic with tests.
  - `tree.ts`: builds, sorts and filters the flattened tree.
  - `profiles.ts`: profiles, resolution, the collapse map.
  - `order.ts`: manual order.
  - `drag.ts`: row geometry and drop targets.
  - `reads.ts`: read/unread state.
  - `derive.ts`: daemon payloads to rows.
  - `format.ts`: model names and times.
- `client/host-observer.ts`: follows one host (paged snapshot, buffered live updates, reconnect-safe).
- `client/store.ts`: one store for every surface. It watches all online hosts and persists profiles, order, reads and collapse state.
- `client/navigator-screen.tsx`, `client/drag-controller.ts`: the tree screen and long-press drag.
- `client/settings-screen.tsx`, `client/profile-sheet.tsx`, `client/sidebar-item.tsx`, `client/header-buttons.tsx`: the other surfaces.
- `client/device.ts`: the only file that touches `localStorage` (web and desktop only).
- `client/paseo.ts`: SDK types derived from `getPaseoClient`, so a Git install compiles without dev dependencies.
- `mockups/index.html`: the original clickable design mockup.

There are no classes anywhere, because the mobile apps run plugins on Hermes.

## License

MIT
