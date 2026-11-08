import { useEffect, useState, type FormEvent } from "react";
import { Glyph, glyph } from "./icons";
import { Pick } from "./pick";
import { api, postJson } from "./api";

type Kind = "opensuitemcp" | "netsuite" | "custom";

type Connection = {
  kind: Kind;
  accountId: string;
  accountMissing: boolean;
  redirectUri: string;
  osmcpUrl: string;
  osmcpHint: string;
  customUrl: string;
  customHint: string;
  mcpClientId: string;
  mcpSecretHint: string;
  suite: "standard" | "all";
  netsuiteMcpUrl: string;
  mcpSignedIn: boolean;
};

const names: Record<Kind, string> = {
  opensuitemcp: "OpenSuiteMCP",
  netsuite: "NetSuite",
  custom: "Another MCP server",
};

export function ConnectionPanel() {
  const [saved, setSaved] = useState<Connection | null>(null);
  const [kind, setKind] = useState<Kind>("opensuitemcp");
  const [accountId, setAccountId] = useState("");
  const [osmcpUrl, setOsmcpUrl] = useState("https://app.opensuitemcp.com/api/mcp");
  const [osmcpToken, setOsmcpToken] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [mcpClientId, setMcpClientId] = useState("");
  const [mcpClientSecret, setMcpClientSecret] = useState("");
  const [suite, setSuite] = useState<"standard" | "all">("standard");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    function load(hintsOnly: boolean) {
      api<Connection>("/api/connector")
        .then((body) => {
          if (ignore) return;
          setSaved(body);
          if (hintsOnly) return;
          setKind(body.kind);
          setAccountId(body.accountId);
          setOsmcpUrl(body.osmcpUrl);
          setCustomUrl(body.customUrl);
          setMcpClientId(body.mcpClientId);
          setSuite(body.suite);
        })
        .catch(() => {
          if (!ignore) setError("The connection settings did not load.");
        });
    }
    load(false);
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "settings") load(true);
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      ignore = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await postJson("/api/config/connector", { kind, accountId, osmcpUrl, osmcpToken, customUrl, customToken, mcpClientId, mcpClientSecret, suite });
      setMessage("Saved. Reloading so the server uses this connection.");
      location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the connection.");
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label>
        Connection
        <Pick
          label="Connection"
          value={kind}
          onChange={(next) => setKind(next as Kind)}
          options={[
            { value: "opensuitemcp", label: "OpenSuiteMCP" },
            { value: "netsuite", label: "NetSuite" },
            { value: "custom", label: "Another MCP server" },
          ]}
        />
      </label>
      <label>
        Account ID
        <input
          value={accountId}
          autoComplete="off"
          maxLength={40}
          pattern="[A-Za-z0-9_\-]+"
          placeholder={kind === "netsuite" ? "1234567 or 1234567_SB1" : "Optional. The connection reports it."}
          onChange={(event) => setAccountId(event.target.value)}
        />
      </label>
      {kind === "opensuitemcp" && (
        <>
          <label>
            Server URL
            <input value={osmcpUrl} onChange={(event) => setOsmcpUrl(event.target.value)} />
          </label>
          <label>
            Bearer token {saved?.osmcpHint ? `(${saved.osmcpHint})` : ""}
            <input type="password" value={osmcpToken} autoComplete="off" placeholder="Leave blank to keep the saved token" onChange={(event) => setOsmcpToken(event.target.value)} />
          </label>
        </>
      )}
      {kind === "netsuite" && (
        <>
          <p className="status">{saved?.netsuiteMcpUrl ? `Tool URL ${saved.netsuiteMcpUrl}` : "Add the account ID to get the tool URL."}</p>
          <label>
            Client ID
            <input value={mcpClientId} autoComplete="off" onChange={(event) => setMcpClientId(event.target.value)} />
          </label>
          <label>
            Client secret {saved?.mcpSecretHint ? `(${saved.mcpSecretHint})` : ""}
            <input type="password" value={mcpClientSecret} autoComplete="off" placeholder="Leave blank to keep the saved secret" onChange={(event) => setMcpClientSecret(event.target.value)} />
          </label>
          <label>
            Tools
            <Pick
              label="Tools"
              value={suite}
              onChange={(next) => setSuite(next as "standard" | "all")}
              options={[
                { value: "standard", label: "Standard tools" },
                { value: "all", label: "Every SuiteApp" },
              ]}
            />
          </label>
          {saved?.mcpSignedIn ? (
            <p className="status">Signed in to NetSuite.</p>
          ) : (
            <p className="status">Save the client ID, then sign in.</p>
          )}
        </>
      )}
      {kind === "custom" && (
        <>
          <label>
            Server URL
            <input value={customUrl} placeholder="https://" onChange={(event) => setCustomUrl(event.target.value)} />
          </label>
          <label>
            Bearer token {saved?.customHint ? `(${saved.customHint})` : ""}
            <input type="password" value={customToken} autoComplete="off" placeholder="Leave blank to keep the saved token" onChange={(event) => setCustomToken(event.target.value)} />
          </label>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {message && <p className="status">{message}</p>}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          Save connection
        </button>
        {kind === "netsuite" &&
          (saved?.accountMissing ? (
            <>
              <button className="quiet" type="button" disabled>
                Sign in with NetSuite
              </button>
              <span className="note">Save the account ID first.</span>
            </>
          ) : (
            <a className="quiet" href="/api/auth/mcp/login">
              <Glyph icon={glyph.signIn} />
              Sign in with NetSuite
            </a>
          ))}
      </div>
      <div key={kind}>
        <details className="panel" open={kind === "opensuitemcp"}>
          <summary>OpenSuiteMCP setup</summary>
          <ol className="steps">
            <li>In the OpenSuiteMCP app portal, create an agent app and choose bearer auth.</li>
            <li>Paste the server URL and the token here. A blank token keeps the one already saved.</li>
            <li>On the NetSuite role, add the Setup permissions MCP Server Connection, Log in using OAuth 2.0 Access Tokens, and REST Web Services.</li>
            <li>Install the MCP Standard Tools SuiteApp. Use a role other than Administrator.</li>
          </ol>
        </details>
        <details className="panel" open={kind === "netsuite"}>
          <summary>NetSuite setup</summary>
          <ol className="steps">
            <li>Under Setup &gt; Company &gt; Enable Features, turn on Server SuiteScript, OAuth 2.0, and REST Web Services.</li>
            <li>From the SuiteApps tab, install MCP Standard Tools.</li>
            <li>On the role, add MCP Server Connection, Log in using OAuth 2.0 Access Tokens, and REST Web Services. The Administrator role cannot use this connector.</li>
            <li>
              Go to Setup &gt; Integration &gt; Manage Integrations &gt; New. Name it headless-ns. Turn on Authorization Code Grant and the NetSuite AI Connector Service scope. Leave token-based authentication and client credentials off.
              <span className="uri">{saved?.redirectUri}</span>
            </li>
            <li>Paste the client ID. Add a secret only when the integration is confidential. For a public client, leave the secret blank.</li>
            <li>Choose Standard tools, or Every SuiteApp to include tools from other installed apps. Save, then sign in.</li>
          </ol>
        </details>
        <details className="panel" open={kind === "custom"}>
          <summary>{names.custom} setup</summary>
          <ol className="steps">
            <li>Use this for Mint, or any other host that already exposes NetSuite MCP tools.</li>
            <li>Paste that host's MCP URL and bearer token. A blank token keeps the one already saved.</li>
            <li>The NetSuite role behind that host still needs MCP Server Connection and the MCP Standard Tools SuiteApp.</li>
          </ol>
        </details>
      </div>
    </form>
  );
}
