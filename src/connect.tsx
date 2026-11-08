import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Glyph, glyph } from "./icons";
import { Button, Lookup } from "./load";
import { Pick } from "./pick";
import { api, postJson } from "./api";

export type Kind = "netsuite" | "custom";

export type Connection = {
  kind: Kind;
  accountId: string;
  accountMissing: boolean;
  redirectUri: string;
  customUrl: string;
  customHint: string;
  mcpClientId: string;
  mcpSecretHint: string;
  mcpConfidential: boolean;
  suite: "standard" | "all";
  netsuiteMcpUrl: string;
  mcpSignedIn: boolean;
};

type Edits = Partial<{
  kind: Kind;
  accountId: string;
  customUrl: string;
  customToken: string;
  mcpClientId: string;
  mcpClientSecret: string;
  clientType: "public" | "confidential";
  suite: "standard" | "all";
}>;

type TestResult = { accountId: string; roleId: string; customers: number };

export const kindNames: Record<Kind, string> = {
  netsuite: "NetSuite OAuth",
  custom: "Custom MCP server",
};

function useConnection() {
  const [saved, setSaved] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Connection>("/api/connector")
      .then(setSaved)
      .catch(() => setError("The connection settings did not load."));
  }, []);
  return { saved, setSaved, error };
}

// The server rewrites every connection key on save, so send the saved values with the edits.
function saveConnection(saved: Connection, edits: Edits) {
  const { kind, accountId, customUrl, mcpClientId, suite } = saved;
  return postJson<Connection>("/api/config/connector", { kind, accountId, customUrl, mcpClientId, suite, ...edits });
}

function savedHint(hint: string) {
  return hint ? `Saved ${hint}. Leave blank to keep it.` : "";
}

const setupSteps: Record<Kind, (redirectUri: string) => ReactNode[]> = {
  netsuite: (redirectUri) => [
    <li key="1">Under Setup &gt; Company &gt; Enable Features, turn on Server SuiteScript, OAuth 2.0, and REST Web Services.</li>,
    <li key="2">From the SuiteApps tab, install MCP Standard Tools.</li>,
    <li key="3">On the role, add MCP Server Connection, Log in using OAuth 2.0 Access Tokens, and REST Web Services. The Administrator role cannot use this connection.</li>,
    <li key="4">
      Go to Setup &gt; Integration &gt; Manage Integrations &gt; New. Name it headless-ns. Turn on Authorization Code Grant and the NetSuite AI Connector Service scope. Use this redirect URI:
      <span className="uri">{redirectUri}</span>
    </li>,
    <li key="5">Paste the client ID here. If Public Client is unchecked on the integration, uncheck it here too and paste the client secret.</li>,
  ],
  custom: () => [
    <li key="1">Use this for OpenSuiteMCP, hosted or self-hosted, or any other server that exposes the NetSuite MCP tools.</li>,
    <li key="2">For OpenSuiteMCP, create an agent app in the app portal and choose bearer auth. The hosted URL is https://app.opensuitemcp.com/api/mcp.</li>,
    <li key="3">The NetSuite role behind that server needs MCP Server Connection, Log in using OAuth 2.0 Access Tokens, REST Web Services, and the MCP Standard Tools SuiteApp. Use a role other than Administrator.</li>,
  ],
};

// Setup step 1. Only the fields the chosen connection needs. A test read must pass before Next.
export function ConnectStep({
  signedInVia,
  authError,
  onNext,
  nextLabel,
}: {
  signedInVia: Kind | null;
  authError: string | null;
  onNext: () => void;
  nextLabel: string;
}) {
  const { saved, setSaved, error: loadError } = useConnection();
  const [kind, setKind] = useState<Kind>("netsuite");
  const [accountId, setAccountId] = useState("");
  const [mcpClientId, setMcpClientId] = useState("");
  const [url, setUrl] = useState("");
  const [clientType, setClientType] = useState<"public" | "confidential">("public");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(authError);
  const [passed, setPassed] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!saved) return;
    setKind(saved.kind);
    setAccountId(saved.accountId);
    setMcpClientId(saved.mcpClientId);
    setUrl(saved.customUrl);
    setClientType(saved.mcpConfidential ? "confidential" : "public");
  }, [saved]);

  const connected = saved != null && signedInVia === kind && saved.kind === kind;

  const test = useCallback(async () => {
    setTesting(true);
    setError(null);
    setPassed(null);
    try {
      setPassed(await postJson<TestResult>("/api/setup/test", {}));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The test read failed.");
    } finally {
      setTesting(false);
    }
  }, []);

  useEffect(() => {
    if (connected && !authError) test();
  }, [connected, authError, test]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!saved) return;
    setBusy(true);
    setError(null);
    setPassed(null);
    try {
      if (kind === "netsuite") {
        await saveConnection(saved, { kind, accountId: accountId.trim(), mcpClientId: mcpClientId.trim(), clientType, mcpClientSecret: secret });
        location.href = "/api/auth/mcp/login";
        return;
      }
      setSaved(await saveConnection(saved, { kind, customUrl: url.trim(), customToken: token }));
      setToken("");
      await test();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the connection.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className="error">{loadError}</p>;
  if (!saved) return <Lookup label="Loading the connection." />;

  const changed =
    kind !== saved.kind ||
    (kind === "netsuite" &&
      (accountId.trim() !== saved.accountId || mcpClientId.trim() !== saved.mcpClientId || secret !== "" || (clientType === "confidential") !== saved.mcpConfidential));

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Connection
        <Pick
          label="Connection"
          value={kind}
          onChange={(next) => {
            setKind(next as Kind);
            setPassed(null);
            setError(null);
          }}
          options={(Object.keys(kindNames) as Kind[]).map((value) => ({ value, label: kindNames[value] }))}
        />
      </label>
      {kind === "netsuite" && (
        <>
          <label>
            Account ID
            <input
              value={accountId}
              required
              autoComplete="off"
              maxLength={40}
              pattern="[A-Za-z0-9_\-]+"
              placeholder="1234567 or 1234567_SB1"
              onChange={(event) => setAccountId(event.target.value)}
            />
          </label>
          <label>
            Client ID
            <input value={mcpClientId} required autoComplete="off" onChange={(event) => setMcpClientId(event.target.value)} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={clientType === "public"}
              onChange={(event) => setClientType(event.target.checked ? "public" : "confidential")}
            />
            Public client
          </label>
          {clientType === "confidential" && (
            <label>
              Client secret
              <input
                type="password"
                value={secret}
                required={!saved.mcpSecretHint}
                autoComplete="off"
                placeholder={savedHint(saved.mcpSecretHint)}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
          )}
        </>
      )}
      {kind === "custom" && (
        <>
          <label>
            Server URL
            <input
              value={url}
              required
              type="url"
              pattern="https://.*"
              placeholder="https://app.opensuitemcp.com/api/mcp"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label>
            Bearer token
            <input
              type="password"
              value={token}
              required={!saved.customHint}
              autoComplete="off"
              placeholder={savedHint(saved.customHint)}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
        </>
      )}
      {testing && <Lookup label="Reading from NetSuite." />}
      {passed && (
        <p className="live-line" role="status">
          Connected. Read {passed.customers} active customers from <strong>{passed.accountId.toUpperCase()}</strong> as {passed.roleId}.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {kind === "netsuite" ? (
          connected && !changed ? (
            <a className="quiet" href="/api/auth/mcp/login">
              <Glyph icon={glyph.signIn} />
              Sign in again
            </a>
          ) : (
            <Button className="primary" type="submit" busy={busy}>
              <Glyph icon={glyph.signIn} />
              Sign in with NetSuite
            </Button>
          )
        ) : (
          <Button className={connected && passed ? "quiet" : "primary"} type="submit" busy={busy}>
            Save and test
          </Button>
        )}
        {connected && !passed && !testing && (
          <Button className="quiet" onClick={test}>
            Test again
          </Button>
        )}
        <Button className="primary" disabled={!passed} onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
      <details className="panel">
        <summary>How to set this up</summary>
        <ol className="steps">{setupSteps[kind](saved.redirectUri)}</ol>
      </details>
    </form>
  );
}

// Settings: the connection fields setup leaves out, plus a way back into setup.
export function ConnectionSettings() {
  const { saved, setSaved, error: loadError } = useConnection();
  const [edits, setEdits] = useState<Edits>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!saved) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setSaved(await saveConnection(saved, edits));
      setEdits({});
      setMessage("Saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the connection.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className="error">{loadError}</p>;
  if (!saved) return <Lookup label="Loading the connection." />;

  const value = <K extends keyof Edits>(key: K, fallback: string) => (edits[key] ?? fallback) as string;
  const set = (key: keyof Edits) => (next: string) => setEdits((current) => ({ ...current, [key]: next }));

  return (
    <form className="form" onSubmit={save}>
      <p className="status">
        {kindNames[saved.kind]}
        {saved.accountId ? ` · account ${saved.accountId.toUpperCase()}` : ""}. <a href="#/setup/netsuite">Change connection</a>
      </p>
      {saved.kind === "netsuite" && (
        <label>
          Tools
          <Pick
            label="Tools"
            value={value("suite", saved.suite)}
            onChange={set("suite")}
            options={[
              { value: "standard", label: "Standard tools" },
              { value: "all", label: "Every SuiteApp" },
            ]}
          />
        </label>
      )}
      {saved.kind === "custom" && (
        <label>
          Account ID, for record links
          <input
            value={value("accountId", saved.accountId)}
            autoComplete="off"
            maxLength={40}
            pattern="[A-Za-z0-9_\-]+"
            placeholder="The connection reports it"
            onChange={(event) => set("accountId")(event.target.value)}
          />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      {message && <p className="status">{message}</p>}
      <div className="actions">
        <Button className="primary" type="submit" busy={busy} disabled={!Object.keys(edits).length}>
          Save connection settings
        </Button>
      </div>
    </form>
  );
}
