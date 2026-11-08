Phone Navigator shows your Paseo workspaces as a Host, Project and Workspace tree on one full screen, built for the phone. A "Workspaces" row in the sidebar opens it and shows a red badge with the number of workspaces that need you (waiting for input, failed or flagged). Every workspace header gets a button back to the tree, and the Command Center has a "Workspaces" entry.

Each workspace row shows its status, title, diff size, branch, the model of its most recently active agent and when it was last active. Hosts, projects and workspaces can each be collapsed, and the tree remembers what you collapsed. The header is one line: search, the attention count (tap to show only those), the All, Active or Attention filter, expand or collapse everything, and the profile.

## Profiles

A profile holds the view settings: density, which details rows show, the default filter, hiding finished workspaces after a day or a week, hidden hosts, and whether new hosts and projects start expanded. Phone (compact, Active) and Desktop (comfortable, All) come built in. Profiles are stored on the host that serves the plugin and shared by all its clients. Each device picks one: the one you chose last, otherwise the profile bound to your platform. Manage them under Settings, Plugins, Phone Navigator.

On web and desktop the chosen profile and the collapse state are kept on the device. The phone apps have no storage for plugins, so there the collapse state is saved into the profile a few seconds after you change it, and the profile you pick lasts until the app restarts.

## Limits

- Needs Paseo 0.15 or later.
- It reads every connected host through the app's own connections. Offline hosts are shown dimmed.
- The header button appears on workspaces of hosts where this plugin is installed; the sidebar row and the Command Center work for all hosts.
- It only reads workspace and agent metadata. It does not read conversations, change workspaces, or contact any outside service.
