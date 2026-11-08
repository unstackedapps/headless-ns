import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConnectStep, type Kind } from "./connect";
import { Button, Lookup } from "./load";
import { Combobox, Pick, type Option } from "./pick";
import { api, postJson } from "./api";
import type { ModelsPayload } from "./studio";

export type SessionInfo = {
  accountId: string;
  signedIn: boolean;
  via: "custom" | "netsuite" | "oidc" | null;
  roleId: string | null;
  ai: boolean;
  osmcpError: string | null;
};

export type SetupStep = "netsuite" | "ai";

const SKIP_KEY = "hn-ai-skipped";

export function aiSkipped() {
  return localStorage.getItem(SKIP_KEY) === "1";
}

// First run shows setup until NetSuite answers and an AI model is saved, or the AI step was skipped.
export function needsSetup(session: SessionInfo) {
  return !session.signedIn || (!session.ai && !aiSkipped());
}

export function setupStepFromHash(hash: string): SetupStep | null {
  if (hash === "setup/ai") return "ai";
  if (hash === "setup" || hash === "setup/netsuite") return "netsuite";
  return null;
}

const titles = { netsuite: "Connect NetSuite", ai: "Connect the AI", done: "Done" };

// The step-by-step setup. With `only`, it opens one step from Settings and returns to Overview.
export function Setup({
  session,
  only,
  authError,
  onFinish,
}: {
  session: SessionInfo;
  only: SetupStep | null;
  authError: string | null;
  onFinish: () => void;
}) {
  const [step, setStep] = useState<SetupStep | "done">(only || "netsuite");
  const [skipped, setSkipped] = useState(false);
  const signedInVia = session.signedIn && session.via !== "oidc" ? (session.via as Kind) : null;

  return (
    <main className="signin">
      <section className="card">
        <img className="mark" src="/favicon.svg" alt="" width="28" height="28" />
        <h1>{only ? titles[only] : "Set up headless-ns"}</h1>
        {!only && (
          <ol className="setup-steps">
            {(["netsuite", "ai", "done"] as const).map((id, index) => (
              <li key={id} aria-current={step === id ? "step" : undefined}>
                {index + 1}. {titles[id]}
              </li>
            ))}
          </ol>
        )}
        {step === "netsuite" && (
          <>
            {!only && <p className="lede">headless-ns reads and writes NetSuite through MCP tools. Pick how it connects.</p>}
            <ConnectStep
              signedInVia={signedInVia}
              authError={authError}
              nextLabel={only ? "Done" : "Next"}
              onNext={() => (only ? onFinish() : setStep("ai"))}
            />
          </>
        )}
        {step === "ai" && (
          <>
            <p className="lede">Ask uses this model to answer questions and draft records. The NetSuite screens work without it.</p>
            <AiStep
              finishLabel={only ? "Save model" : "Finish"}
              onFinish={() => {
                localStorage.removeItem(SKIP_KEY);
                if (only) onFinish();
                else setStep("done");
              }}
              onSkip={
                only
                  ? undefined
                  : () => {
                      localStorage.setItem(SKIP_KEY, "1");
                      setSkipped(true);
                      setStep("done");
                    }
              }
            />
          </>
        )}
        {step === "done" && (
          <>
            <p className="lede">
              {skipped
                ? "NetSuite is connected. Ask stays off until you connect an AI model from Settings."
                : "NetSuite and the AI model are connected."}
            </p>
            <div className="actions">
              <Button className="primary" onClick={onFinish}>
                Open Overview
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

type Draft = { provider: string; baseUrl: string; apiKey: string };

// Setup step 2. Provider, URL when it needs one, key, then a model from the provider's own list.
function AiStep({ finishLabel, onFinish, onSkip }: { finishLabel: string; onFinish: () => void; onSkip?: () => void }) {
  const [models, setModels] = useState<ModelsPayload | null>(null);
  const [draft, setDraft] = useState<Draft>({ provider: "openai", baseUrl: "", apiKey: "" });
  const [model, setModel] = useState<Option | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<{ key: string; ids: Promise<string[]> } | null>(null);

  useEffect(() => {
    api<{ models: ModelsPayload }>("/api/config")
      .then(({ models: payload }) => {
        setModels(payload);
        const active = payload.connections.find((row) => row.id === payload.activeId);
        if (active) setDraft({ provider: active.provider, baseUrl: active.baseUrl, apiKey: "" });
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const spec = models?.providers.find((item) => item.id === draft.provider);
  const savedKey = models?.connections.find((row) => row.provider === draft.provider && row.baseUrl === (spec?.needsBaseUrl ? draft.baseUrl.replace(/\/$/, "") : ""))?.keyMask;

  function change(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setModel(null);
    setReply(null);
    setError(null);
  }

  // The provider's list loads once per provider, URL, and key, then typing filters it.
  async function searchModels(text: string) {
    const key = JSON.stringify(draft);
    if (list.current?.key !== key) {
      const ids = postJson<{ models: string[] }>("/api/models/list", draft).then((body) => body.models);
      list.current = { key, ids };
      ids.catch(() => {
        if (list.current?.key === key) list.current = null;
      });
    }
    const ids = await list.current.ids;
    const needle = text.trim().toLowerCase();
    return ids.filter((id) => id.toLowerCase().includes(needle)).slice(0, 200).map((id) => ({ id, label: id }));
  }

  async function test(event: FormEvent) {
    event.preventDefault();
    if (!model) return;
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const body = await postJson<{ reply: string }>("/api/models/test", { ...draft, model: model.id });
      setReply(body.reply);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The model did not reply.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/models", { ...draft, model: model.id, activate: true });
      onFinish();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the model.");
      setBusy(false);
    }
  }

  if (!models && !error) return <Lookup label="Loading the model providers." />;

  return (
    <form className="form" onSubmit={test}>
      <label>
        Provider
        <Pick
          label="Provider"
          value={draft.provider}
          onChange={(provider) => change({ provider })}
          options={(models?.providers || []).map((item) => ({ value: item.id, label: item.label }))}
        />
      </label>
      {spec?.needsBaseUrl && (
        <label>
          Provider URL
          <input
            value={draft.baseUrl}
            required
            type="url"
            placeholder="https://host/v1"
            onChange={(event) => change({ baseUrl: event.target.value })}
          />
        </label>
      )}
      <label>
        API key
        <input
          type="password"
          value={draft.apiKey}
          required={!savedKey}
          autoComplete="off"
          placeholder={savedKey ? `Saved ${savedKey}. Leave blank to keep it.` : ""}
          onChange={(event) => change({ apiKey: event.target.value })}
        />
      </label>
      <label>
        Model
        <Combobox
          label="Model"
          value={model}
          placeholder="Search the provider's models"
          searching="Loading the provider's models."
          disabled={(spec?.needsBaseUrl && !draft.baseUrl.trim()) || (!draft.apiKey.trim() && !savedKey)}
          search={searchModels}
          onChange={(next) => {
            setModel(next);
            setReply(null);
          }}
        />
      </label>
      {reply != null && (
        <p className="live-line" role="status">
          The model replied: {reply}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <Button className={reply ? "quiet" : "primary"} type="submit" busy={busy && !reply} disabled={!model}>
          Send test message
        </Button>
        <Button className="primary" busy={busy && Boolean(reply)} disabled={!reply} onClick={finish}>
          {finishLabel}
        </Button>
        {onSkip && (
          <Button className="quiet" onClick={onSkip}>
            Skip for now
          </Button>
        )}
      </div>
    </form>
  );
}
