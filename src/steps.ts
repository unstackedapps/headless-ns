// Plain words for the NetSuite tools, so Ask's steps never show raw tool names.
const verbs: Record<string, [past: string, base: string]> = {
  ns_runCustomSuiteQL: ["Ran a SuiteQL query", "run a SuiteQL query"],
  ns_getSuiteQLMetadata: ["Read a table's columns", "read a table's columns"],
  ns_getRecordTypeMetadata: ["Read a record type's fields", "read a record type's fields"],
  ns_getRecord: ["Read a record", "read a record"],
  ns_createRecord: ["Created a record", "create a record"],
  ns_updateRecord: ["Updated a record", "update a record"],
  ns_transformRecord: ["Turned one record into another", "turn one record into another"],
  ns_executeRecordAction: ["Ran a record action", "run a record action"],
  ns_runReport: ["Ran a report", "run a report"],
  ns_listAllReports: ["Listed the saved reports", "list the saved reports"],
  ns_getSubsidiaries: ["Read the subsidiaries", "read the subsidiaries"],
  ns_runSavedSearch: ["Ran a saved search", "run a saved search"],
  ns_listSavedSearches: ["Listed the saved searches", "list the saved searches"],
  ns_getSessionInfo: ["Read the account and role", "read the account and role"],
  osmcp_search_netsuite_docs: ["Searched the NetSuite help", "search the NetSuite help"],
};

function spaced(name: string) {
  return name.replace(/^(ns|osmcp)_/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// "Run a SuiteQL query", for settings and lists of tools.
export function toolTitle(name: string) {
  const base = verbs[name]?.[1] || `call ${spaced(name)}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// "Ran a SuiteQL query", or "Could not run a SuiteQL query. <reason>"
export function stepText(step: { name: string; ok: boolean; error?: string }) {
  const [past, base] = verbs[step.name] || [`Called ${spaced(step.name)}`, `call ${spaced(step.name)}`];
  if (step.ok) return past;
  return `Could not ${base}.${step.error ? ` ${step.error}` : ""}`;
}
