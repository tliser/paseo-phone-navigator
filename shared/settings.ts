import { defineSettings } from "@getpaseo/plugin";
import { profilesDocumentSchema } from "./profiles";

/** Profiles live in one host document on the host serving the plugin, shared by all its clients. */
export const profilesSettings = defineSettings({
  id: "profiles",
  scope: "host",
  version: 1,
  schema: profilesDocumentSchema,
});
