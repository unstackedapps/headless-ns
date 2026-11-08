export const WRITE_TOOLS = new Set([
  "ns_createRecord",
  "ns_updateRecord",
  "ns_transformRecord",
  "ns_executeRecordAction",
  "ns_attachFile",
  "ns_detachFile",
  "ns_uploadFile",
]);

export const APP_TOOLS = new Set([
  "ns_fileCabinet_app",
  "ns_getFileApp",
  "ns_uploadFileApp",
  "ns_prompt_library_app",
  "ns_report_filters_app",
  "ns_selector_app",
]);

export const INTERNAL_TOOLS = new Set(["ns_getFile", "ns_uploadFile"]);

export function toolKind(name) {
  if (INTERNAL_TOOLS.has(name)) return "internal";
  if (APP_TOOLS.has(name)) return "app";
  if (WRITE_TOOLS.has(name)) return "write";
  return "read";
}

export function assistantCanCall(name, policy) {
  const kind = toolKind(name);
  if (kind === "internal" || kind === "app") return false;
  if (policy.disabled?.includes(name)) return false;
  if (kind === "write") return Boolean(policy.allowWrites);
  return name.startsWith("ns_") || name === "osmcp_search_netsuite_docs";
}
