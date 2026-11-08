import { defineSettings } from "@getpaseo/plugin";
import { profilesDocumentSchema } from "./profiles";
import { readsDocumentSchema } from "./reads";

/** Profiles live in one host document on the host serving the plugin, shared by all its clients. */
export const profilesSettings = defineSettings({
  id: "profiles",
  scope: "host",
  version: 1,
  schema: profilesDocumentSchema,
});

/** When you last viewed each workspace, shared by every device, so reading on the phone counts on the desktop. */
export const readsSettings = defineSettings({
  id: "reads",
  scope: "host",
  version: 1,
  schema: readsDocumentSchema,
});
