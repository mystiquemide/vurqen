'use client';

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Health = {
  ok: boolean;
  provider: "bingx" | "weex";
  mode: "paper" | "read_only" | "replay";
  aiProvider: "gemini" | "groq" | "none";
  aiModel: string;
  aiConfigured: boolean;
  bingxConfigured: boolean;
  weexConfigured: boolean;
};

type ProviderName = Health["provider"];
type RunMode = Health["mode"];

type Run = {
  id: string;
  provider: "bingx" | "weex";
  mode: "paper" | "read_only" | "replay";
  status: string;
  createdAt: string;
  updatedAt: string;
  faultCount: number;
};

type RequestState = "idle" | "starting" | "created" | "error";
type PreflightCheck = {
  name: string;
  status: "PASS" | "WARN" | "FAIL" | "SKIP";
  detail: string;
  source?: string;
};
type PreflightStatus = "PASS" | "WARN" | "FAIL";
type PreflightSummary = {
  provider: ProviderName;
  mode: RunMode;
  status: PreflightStatus;
  checks: PreflightCheck[];
  run: Run;
};
type IntentRecord = {
  id: string;
  runId: string;
  provider: ProviderName;
  mode: RunMode;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  positionSide: "LONG" | "SHORT";
  quantity: string;
  price?: string;
  clientOrderId: string;
  createdAt: string;
};
type Observation = {
  id: string;
  source: string;
  eventType: string;
  receivedAt: string;
  payloadHash: string;
  providerTimestamp?: number;
  sequence?: number;
  payload?: unknown;
  relatedIntentId?: string;
  faultType?: "drop_event" | "duplicate_event";
};
type IntentResult = {
  run: Run;
  intent: IntentRecord;
  observations: Observation[];
  submission?: unknown;
};
type ReconciliationRecord = {
  id: string;
  runId: string;
  intentId: string;
  verdict: "RECONCILED" | "REJECTED" | "PARTIALLY_FILLED" | "UNKNOWN_BLOCKED" | "PROVIDER_UNAVAILABLE";
  localState: string;
  providerState: string;
  matchedFields: string[];
  mismatchedFields: string[];
  ruleResults: Array<{ name: string; passed: boolean; detail: string }>;
  createdAt: string;
};
type IncidentRecord = {
  id: string;
  runId: string;
  severity: "INFO" | "WARNING" | "HIGH";
  verdict: ReconciliationRecord["verdict"];
  trigger: string;
  summary: string;
  evidenceIds: string[];
  recommendedAction: string;
  createdAt: string;
};
type AgentActionRecord = {
  id: string;
  action: string;
  reason: string;
  inputEvidenceIds: string[];
  outputEvidenceIds: string[];
  createdAt: string;
};
type AiExplanationRecord = {
  headline: string;
  explanation: string;
  nextAction: string;
  evidenceIds: string[];
};
type RunDetail = {
  run: Run;
  intent?: IntentRecord;
  observations: Observation[];
  reconciliation?: ReconciliationRecord;
  incident?: IncidentRecord;
  agentActions: AgentActionRecord[];
  aiExplanation?: AiExplanationRecord;
};
type ReceiptRecord = {
  schemaVersion: "1.0";
  receiptId: string;
  runId: string;
  provider: ProviderName;
  mode: RunMode;
  verdict: ReconciliationRecord["verdict"];
  createdAt: string;
  intent: IntentRecord;
  observations: Observation[];
  reconciliation?: ReconciliationRecord;
  incident?: IncidentRecord;
  agentActions: AgentActionRecord[];
  aiExplanation?: AiExplanationRecord;
  evidenceDigest: string;
};
type IncidentResponse = {
  incident: IncidentRecord;
  run: Run;
  receipt: ReceiptRecord;
};

function ArrowUpRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="icon icon-arrow">
      <path d="M4 14 14 4M6 4h8v8" />
    </svg>
  );
}

type ProofIconKind = "intent" | "evidence" | "reconcile" | "receipt";

function ProofIcon({ kind }: { kind: ProofIconKind }) {
  if (kind === "intent") {
    return (
      <svg aria-hidden="true" viewBox="0 0 48 48" className="proof-icon">
        <rect x="10" y="8" width="28" height="32" rx="3" />
        <path d="M16 17h16M16 24h16M16 31h9" />
        <path d="m30 30 3 3 6-7" />
      </svg>
    );
  }

  if (kind === "evidence") {
    return (
      <svg aria-hidden="true" viewBox="0 0 48 48" className="proof-icon">
        <path d="M24 7 38 13v10c0 8.6-5.7 14.9-14 18-8.3-3.1-14-9.4-14-18V13l14-6Z" />
        <path d="m17 24 5 5 10-11" />
      </svg>
    );
  }

  if (kind === "reconcile") {
    return (
      <svg aria-hidden="true" viewBox="0 0 48 48" className="proof-icon">
        <path d="M14 15h20M14 24h20M14 33h12" />
        <path d="m29 30 4 4 7-8" />
        <path d="M9 15h1M9 24h1M9 33h1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="proof-icon">
      <path d="M13 7h17l7 7v27H13V7Z" />
      <path d="M30 7v8h7M18 23h14M18 29h14M18 35h8" />
    </svg>
  );
}

type GuardrailIconKind = "stop" | "source" | "receipt";

function GuardrailIcon({ kind }: { kind: GuardrailIconKind }) {
  if (kind === "stop") {
    return (
      <svg aria-hidden="true" viewBox="0 0 48 48" className="guardrail-icon">
        <rect x="10" y="10" width="28" height="28" rx="3" />
        <path d="m17 17 14 14M31 17 17 31" />
      </svg>
    );
  }

  if (kind === "source") {
    return (
      <svg aria-hidden="true" viewBox="0 0 48 48" className="guardrail-icon">
        <circle cx="22" cy="22" r="11" />
        <path d="m30 30 9 9M17 22h10M22 17v10" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="guardrail-icon">
      <path d="M13 7h17l7 7v27H13V7Z" />
      <path d="M30 7v8h7M18 23h14M18 29h10M18 35h14" />
    </svg>
  );
}

function preflightStatus(checks: PreflightCheck[]): PreflightStatus {
  if (checks.some((check) => check.status === "FAIL")) return "FAIL";
  if (checks.some((check) => check.status === "WARN")) return "WARN";
  return "PASS";
}

function modeLabel(mode: RunMode) {
  return mode.replace("_", " ").toUpperCase();
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type RunSetupScreenProps = {
  health: Health | null;
  runState: RequestState;
  runError: string | null;
  preflight: PreflightSummary | null;
  onPreflight: (provider: ProviderName, mode: RunMode) => void;
};

function RunSetupScreen({ health, runState, runError, preflight, onPreflight }: RunSetupScreenProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>(health?.provider ?? "bingx");
  const [selectedMode, setSelectedMode] = useState<RunMode>(health?.mode ?? "read_only");

  useEffect(() => {
    if (!health) return;
    setSelectedProvider(health.provider);
    setSelectedMode(health.mode);
  }, [health]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onPreflight(selectedProvider, selectedMode);
  }

  const statusHeading = preflight?.status === "FAIL" ? "Resolve the boundary first." : preflight?.status === "WARN" ? "Review the warnings before continuing." : "The boundary is clear.";

  return (
    <div className="setup-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p className="nav-purpose">RUN PREFLIGHT</p>
        <div className="nav-actions">
          <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
            Read source <ArrowUpRight />
          </a>
        </div>
      </nav>

      <main className="setup-main">
        <a className="setup-back" href="/">Back to overview</a>
        <div className="setup-intro">
          <p className="section-eyebrow">START A PROOF RUN</p>
          <h1>Choose the boundary before the action.</h1>
          <p className="section-summary">
            Pick the exchange boundary and operating mode first. Vurqen checks the environment before it asks the workflow to continue.
          </p>
        </div>

        <div className="setup-layout">
          <form className="setup-form" onSubmit={handleSubmit}>
            <fieldset className="setup-fieldset">
              <legend>Provider</legend>
              <div className="choice-grid">
                <label className={`choice-card${selectedProvider === "bingx" ? " choice-card-selected" : ""}`}>
                  <input type="radio" name="provider" value="bingx" checked={selectedProvider === "bingx"} onChange={() => setSelectedProvider("bingx")} />
                  <span className="choice-copy">
                    <strong>BingX</strong>
                    <span>VST paper and read-only workflows</span>
                  </span>
                </label>
                <label className={`choice-card${selectedProvider === "weex" ? " choice-card-selected" : ""}`}>
                  <input type="radio" name="provider" value="weex" checked={selectedProvider === "weex"} onChange={() => setSelectedProvider("weex")} />
                  <span className="choice-copy">
                    <strong>WEEX</strong>
                    <span>V3 paper and read-only workflows</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="setup-fieldset">
              <legend>Operating mode</legend>
              <div className="mode-list">
                <label className={`mode-card${selectedMode === "read_only" ? " mode-card-selected" : ""}`}>
                  <input type="radio" name="mode" value="read_only" checked={selectedMode === "read_only"} onChange={() => setSelectedMode("read_only")} />
                  <span className="choice-copy">
                    <strong>Read-only</strong>
                    <span>Inspect provider state without submitting an order.</span>
                  </span>
                </label>
                <label className={`mode-card${selectedMode === "paper" ? " mode-card-selected" : ""}`}>
                  <input type="radio" name="mode" value="paper" checked={selectedMode === "paper"} onChange={() => setSelectedMode("paper")} />
                  <span className="choice-copy">
                    <strong>Paper</strong>
                    <span>Use the provider paper environment when checks pass.</span>
                  </span>
                </label>
                <label className={`mode-card${selectedMode === "replay" ? " mode-card-selected" : ""}`}>
                  <input type="radio" name="mode" value="replay" checked={selectedMode === "replay"} onChange={() => setSelectedMode("replay")} />
                  <span className="choice-copy">
                    <strong>Replay</strong>
                    <span>Run deterministic local observations with every fault labeled.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <button className="button button-primary setup-submit" type="submit" disabled={!health || runState === "starting"}>
              {runState === "starting" ? "Checking the boundary" : preflight ? "Run preflight again" : "Run preflight"} <ArrowUpRight />
            </button>
            {!health && <p className="setup-loading">Loading the provider configuration...</p>}
            {runError && <p className="run-feedback run-feedback-error" role="alert">{runError}</p>}
          </form>

          <section className="preflight-panel" aria-live="polite" aria-labelledby="preflight-title">
            {preflight ? (
              <>
                <div className="preflight-header">
                  <div>
                    <p className="run-card-label">PREFLIGHT RESULT</p>
                    <h2 id="preflight-title">{statusHeading}</h2>
                  </div>
                  <span className={`preflight-badge preflight-badge-${preflight.status.toLowerCase()}`}>{preflight.status}</span>
                </div>
                <dl className="preflight-meta">
                  <div>
                    <dt>Provider</dt>
                    <dd>{preflight.provider.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>{modeLabel(preflight.mode)}</dd>
                  </div>
                  <div>
                    <dt>Run</dt>
                    <dd>{preflight.run.id}</dd>
                  </div>
                  <div>
                    <dt>State</dt>
                    <dd>{preflight.run.status}</dd>
                  </div>
                </dl>
                <ul className="check-list">
                  {preflight.checks.map((check) => (
                    <li className={`check-row check-row-${check.status.toLowerCase()}`} key={`${check.name}-${check.status}`}>
                      <span className="check-marker" aria-hidden="true" />
                      <span className="check-copy">
                        <strong>{check.name}</strong>
                        <span>{check.detail}</span>
                        {check.source && <small>{check.source}</small>}
                      </span>
                      <span className="check-status">{check.status}</span>
                    </li>
                  ))}
                </ul>
                {preflight.status !== "FAIL" && (
                  <a className="button button-primary preflight-continue" href={`/run/${encodeURIComponent(preflight.run.id)}/intent`}>
                    Continue to intent <ArrowUpRight />
                  </a>
                )}
              </>
            ) : (
              <div className="preflight-empty">
                <p className="run-card-label">BEFORE THE WORKFLOW</p>
                <h2 id="preflight-title">Check the boundary first.</h2>
                <p>Vurqen will create the run, check the selected provider, and keep the result tied to the run ID.</p>
                <div className="preflight-empty-line" aria-hidden="true" />
                <span>Provider configuration stays on the server.</span>
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p>Evidence before action.</p>
        <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
          Open source on GitHub <ArrowUpRight />
        </a>
      </footer>
    </div>
  );
}

type IntentScreenState = "loading" | "ready" | "submitting" | "created" | "error";

type IntentScreenProps = {
  runId: string;
};

function IntentScreen({ runId }: IntentScreenProps) {
  const [run, setRun] = useState<Run | null>(null);
  const [screenState, setScreenState] = useState<IntentScreenState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitPaperOrder, setSubmitPaperOrder] = useState(false);
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [form, setForm] = useState({
    symbol: "",
    side: "BUY" as IntentRecord["side"],
    orderType: "MARKET" as IntentRecord["orderType"],
    positionSide: "LONG" as IntentRecord["positionSide"],
    quantity: "",
    price: "",
    clientOrderId: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    setScreenState("loading");
    setLoadError(null);
    void fetch(`/api/runs/${encodeURIComponent(runId)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as { run?: Run; error?: string };
        if (!response.ok || !payload.run) throw new Error(payload.error ?? `Run request failed with HTTP ${response.status}`);
        setRun(payload.run);
        setScreenState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setScreenState("error");
        setLoadError(error instanceof Error ? error.message : "The run could not be loaded");
      });
    return () => controller.abort();
  }, [runId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!run) return;

    const symbol = form.symbol.trim();
    const quantity = form.quantity.trim();
    const price = form.price.trim();
    if (!symbol || !quantity || (form.orderType === "LIMIT" && !price)) {
      setFormError(form.orderType === "LIMIT" ? "Add the symbol, quantity, and limit price before recording the intent." : "Add the symbol and quantity before recording the intent.");
      return;
    }

    setScreenState("submitting");
    setFormError(null);
    setIntentResult(null);
    void fetch(`/api/runs/${encodeURIComponent(runId)}/intents`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        symbol,
        side: form.side,
        orderType: form.orderType,
        positionSide: form.positionSide,
        quantity,
        price: form.orderType === "LIMIT" ? price : undefined,
        clientOrderId: form.clientOrderId.trim() || undefined,
        submit: run.mode === "paper" && submitPaperOrder,
      }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          run?: Run;
          intent?: IntentRecord;
          observations?: Observation[];
          submission?: unknown;
          error?: string;
        };
        if (!response.ok || !payload.intent) throw new Error(payload.error ?? `Intent request failed with HTTP ${response.status}`);
        const nextRun = payload.run ?? run;
        setRun(nextRun);
        setIntentResult({
          run: nextRun,
          intent: payload.intent,
          observations: payload.observations ?? [],
          submission: payload.submission,
        });
        setScreenState("created");
      })
      .catch((error: unknown) => {
        setScreenState("error");
        setFormError(error instanceof Error ? error.message : "The intent could not be recorded");
      });
  }

  return (
    <div className="setup-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p className="nav-purpose">RUN INTENT</p>
        <div className="nav-actions">
          <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
            Read source <ArrowUpRight />
          </a>
        </div>
      </nav>

      <main className="intent-main">
        <a className="setup-back" href="/run/new">Back to setup</a>
        {screenState === "loading" && <p className="screen-state-message">Loading the run record...</p>}
        {screenState === "error" && !run && (
          <section className="screen-error" role="alert">
            <p className="section-eyebrow">RUN UNAVAILABLE</p>
            <h1>We couldn’t load this run.</h1>
            <p>{loadError ?? formError}</p>
            <a className="button button-primary" href="/run/new">Start another run <ArrowUpRight /></a>
          </section>
        )}

        {run && (
          <>
            <div className="intent-intro">
              <p className="section-eyebrow">RECORD THE INTENT</p>
              <h1>Make the intent explicit.</h1>
              <p className="section-summary">
                Put the action in a canonical record before the workflow asks the exchange to prove anything.
              </p>
            </div>

            <dl className="intent-context">
              <div>
                <dt>Provider</dt>
                <dd>{run.provider.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{modeLabel(run.mode)}</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd>{run.id}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{run.status}</dd>
              </div>
            </dl>

            <div className="intent-layout">
              <form className="intent-form" onSubmit={handleSubmit}>
                <div className="intent-form-heading">
                  <p className="run-card-label">ORDER INTENT</p>
                  <h2>What should this run record?</h2>
                </div>

                <div className="intent-field-grid">
                  <label className="intent-field intent-field-wide">
                    <span>Exchange symbol</span>
                    <input type="text" value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} autoComplete="off" required />
                    <small>Use the exact symbol supported by the selected provider.</small>
                  </label>
                  <label className="intent-field">
                    <span>Side</span>
                    <select value={form.side} onChange={(event) => setForm((current) => ({ ...current, side: event.target.value as IntentRecord["side"] }))}>
                      <option value="BUY">Buy</option>
                      <option value="SELL">Sell</option>
                    </select>
                  </label>
                  <label className="intent-field">
                    <span>Order type</span>
                    <select value={form.orderType} onChange={(event) => setForm((current) => ({ ...current, orderType: event.target.value as IntentRecord["orderType"] }))}>
                      <option value="MARKET">Market</option>
                      <option value="LIMIT">Limit</option>
                    </select>
                  </label>
                  <label className="intent-field">
                    <span>Position side</span>
                    <select value={form.positionSide} onChange={(event) => setForm((current) => ({ ...current, positionSide: event.target.value as IntentRecord["positionSide"] }))}>
                      <option value="LONG">Long</option>
                      <option value="SHORT">Short</option>
                    </select>
                  </label>
                  <label className="intent-field">
                    <span>Quantity</span>
                    <input type="text" inputMode="decimal" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} autoComplete="off" required />
                  </label>
                  {form.orderType === "LIMIT" && (
                    <label className="intent-field">
                      <span>Limit price</span>
                      <input type="text" inputMode="decimal" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} autoComplete="off" required />
                    </label>
                  )}
                  <label className="intent-field intent-field-wide">
                    <span>Client order ID <em>optional</em></span>
                    <input type="text" value={form.clientOrderId} onChange={(event) => setForm((current) => ({ ...current, clientOrderId: event.target.value }))} autoComplete="off" />
                    <small>Leave blank and the server will generate a deterministic ID.</small>
                  </label>
                </div>

                {run.mode === "paper" && (
                  <label className="paper-submit-toggle">
                    <input type="checkbox" checked={submitPaperOrder} onChange={(event) => setSubmitPaperOrder(event.target.checked)} />
                    <span className="choice-copy">
                      <strong>Submit a paper order after recording the intent</strong>
                      <span>This sends the request to the selected provider’s paper environment.</span>
                    </span>
                  </label>
                )}

                <button className="button button-primary intent-submit" type="submit" disabled={screenState === "submitting"}>
                  {screenState === "submitting" ? "Recording the intent" : submitPaperOrder ? "Record and submit paper order" : "Record intent"} <ArrowUpRight />
                </button>
                {formError && <p className="run-feedback run-feedback-error" role="alert">{formError}</p>}
              </form>

              <aside className="intent-result" aria-live="polite">
                {intentResult ? (
                  <>
                    <div className="intent-result-header">
                      <div>
                        <p className="run-card-label">INTENT RECORDED</p>
                        <h2>Attached to the run.</h2>
                      </div>
                      <span className="preflight-badge preflight-badge-pass">SAVED</span>
                    </div>
                    <dl className="intent-result-details">
                      <div>
                        <dt>Client order ID</dt>
                        <dd>{intentResult.intent.clientOrderId}</dd>
                      </div>
                      <div>
                        <dt>Symbol</dt>
                        <dd>{intentResult.intent.symbol}</dd>
                      </div>
                      <div>
                        <dt>Action</dt>
                        <dd>{intentResult.intent.side} / {intentResult.intent.orderType}</dd>
                      </div>
                      <div>
                        <dt>Quantity</dt>
                        <dd>{intentResult.intent.quantity}</dd>
                      </div>
                      <div>
                        <dt>Observations</dt>
                        <dd>{intentResult.observations.length}</dd>
                      </div>
                      <div>
                        <dt>Recorded at</dt>
                        <dd>{formatTimestamp(intentResult.intent.createdAt)}</dd>
                      </div>
                    </dl>
                    <p className="intent-result-note">The server returned this record and attached the observations to the same run.</p>
                    <a className="button button-primary intent-continue" href={`/run/${encodeURIComponent(intentResult.run.id)}`}>
                      Open active run <ArrowUpRight />
                    </a>
                  </>
                ) : (
                  <div className="intent-result-empty">
                    <p className="run-card-label">THE RECORD</p>
                    <h2>The server response will appear here.</h2>
                    <p>Record the intent to see its generated ID and any provider observations.</p>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p>Evidence before action.</p>
        <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
          Open source on GitHub <ArrowUpRight />
        </a>
      </footer>
    </div>
  );
}

type ActiveRunState = "loading" | "ready" | "working" | "error";

type ActiveRunScreenProps = {
  runId: string;
};

function eventLabel(value: string) {
  return value.replace(/_/g, " ");
}

function verdictHeading(verdict: ReconciliationRecord["verdict"] | undefined) {
  switch (verdict) {
    case "RECONCILED":
      return "STATE RECONCILED";
    case "REJECTED":
      return "ORDER REJECTED";
    case "PARTIALLY_FILLED":
      return "PARTIALLY FILLED";
    case "UNKNOWN_BLOCKED":
      return "UNKNOWN ORDER / DO NOT RETRY";
    case "PROVIDER_UNAVAILABLE":
      return "PROVIDER UNAVAILABLE";
    default:
      return "AWAITING RECONCILIATION";
  }
}

function verdictDescription(detail: RunDetail) {
  if (detail.incident?.summary) return detail.incident.summary;
  if (detail.reconciliation) {
    const failedRule = detail.reconciliation.ruleResults.find((rule) => !rule.passed);
    return failedRule?.detail ?? `Local state ${detail.reconciliation.localState} was compared with provider state ${detail.reconciliation.providerState}.`;
  }
  return "No deterministic verdict has been returned for this run.";
}

function receiptDescription(receipt: ReceiptRecord) {
  if (receipt.incident?.summary) return receipt.incident.summary;
  if (receipt.reconciliation) {
    const failedRule = receipt.reconciliation.ruleResults.find((rule) => !rule.passed);
    return failedRule?.detail ?? `The deterministic engine returned ${receipt.reconciliation.verdict}.`;
  }
  return "This receipt contains the intent and evidence collected so far. Reconcile the run to receive a final verdict.";
}

function ActiveRunScreen({ runId }: ActiveRunScreenProps) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [screenState, setScreenState] = useState<ActiveRunState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null);
  const [replayEventType, setReplayEventType] = useState("");
  const [replayPayload, setReplayPayload] = useState("");
  const [replaySequence, setReplaySequence] = useState("");
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);

  const fetchDetail = useCallback(async () => {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json()) as RunDetail & { error?: string };
    if (!response.ok || !payload.run) throw new Error(payload.error ?? `Run request failed with HTTP ${response.status}`);
    return payload;
  }, [runId]);

  const loadDetail = useCallback(async () => {
    setScreenState("loading");
    setError(null);
    try {
      const nextDetail = await fetchDetail();
      setDetail(nextDetail);
      setScreenState("ready");
    } catch (loadError) {
      setScreenState("error");
      setError(loadError instanceof Error ? loadError.message : "The run could not be loaded");
    }
  }, [fetchDetail]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!detail) return;
    const selectedStillExists = detail.observations.some((observation) => observation.id === selectedObservationId);
    if (!selectedStillExists) setSelectedObservationId(detail.observations.at(-1)?.id ?? null);
  }, [detail, selectedObservationId]);

  useEffect(() => {
    if (!evidenceDrawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEvidenceDrawerOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [evidenceDrawerOpen]);

  async function performAction(action: "faults" | "observations" | "reconcile", body?: Record<string, unknown>) {
    if (!detail) return;
    setScreenState("working");
    setError(null);
    setActionNotice(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/${action}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as RunDetail & { error?: string; observation?: Observation };
      if (!response.ok) throw new Error(payload.error ?? `${action} request failed with HTTP ${response.status}`);

      if (action === "reconcile") {
        if (!payload.run || !payload.observations) throw new Error("Reconciliation response did not include the updated run evidence");
        setDetail(payload);
        setSelectedObservationId(payload.observations.at(-1)?.id ?? null);
        setActionNotice("Reconciliation completed from the backend.");
      } else {
        const nextDetail = await fetchDetail();
        setDetail(nextDetail);
        setSelectedObservationId(nextDetail.observations.at(-1)?.id ?? null);
        setActionNotice(action === "faults" ? "Controlled fault recorded and the evidence rail refreshed." : "Replay observation recorded and the evidence rail refreshed.");
      }
      setScreenState("ready");
    } catch (actionError) {
      setScreenState("error");
      setError(actionError instanceof Error ? actionError.message : "The run action could not be completed");
    }
  }

  function handleReplayObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const eventType = replayEventType.trim();
    if (!eventType || !replayPayload.trim()) {
      setError("Add an event type and a JSON payload before recording a replay observation.");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(replayPayload);
    } catch {
      setError("Replay payload must be valid JSON.");
      return;
    }

    const body: Record<string, unknown> = { source: "REPLAY", eventType, payload };
    if (replaySequence.trim()) {
      const sequence = Number(replaySequence);
      if (!Number.isInteger(sequence) || sequence < 0) {
        setError("Sequence must be a non-negative whole number.");
        return;
      }
      body.sequence = sequence;
    }
    void performAction("observations", body);
  }

  const observations = detail ? [...detail.observations].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt)) : [];
  const selectedObservation = observations.find((observation) => observation.id === selectedObservationId) ?? observations.at(-1);
  const faultSource = [...observations].reverse().find((observation) => observation.source !== "LOCAL_FAULT" && !observation.eventType.startsWith("ORDER_HISTORY"));
  const reconciliationVerdict = detail?.reconciliation?.verdict;
  const canReconcile = Boolean(detail?.intent) && (!reconciliationVerdict || reconciliationVerdict === "UNKNOWN_BLOCKED" || reconciliationVerdict === "PROVIDER_UNAVAILABLE");
  const verdictClass = reconciliationVerdict ? reconciliationVerdict.toLowerCase().replace("_", "-") : "pending";

  return (
    <div className="run-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p className="nav-purpose">{detail ? `${detail.run.provider.toUpperCase()} / ${modeLabel(detail.run.mode)}` : "ACTIVE RUN"}</p>
        <div className="nav-actions">
          <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
            Read source <ArrowUpRight />
          </a>
        </div>
      </nav>

      <main className="run-main">
        <a className="setup-back" href={detail?.intent ? `/run/${encodeURIComponent(runId)}/intent` : "/run/new"}>Back to {detail?.intent ? "intent" : "setup"}</a>
        {screenState === "loading" && <p className="screen-state-message">Loading the run evidence...</p>}
        {screenState === "error" && !detail && (
          <section className="screen-error" role="alert">
            <p className="section-eyebrow">RUN UNAVAILABLE</p>
            <h1>We couldn’t load this run.</h1>
            <p>{error ?? "The server did not return a run record."}</p>
            <a className="button button-primary" href="/run/new">Start another run <ArrowUpRight /></a>
          </section>
        )}

        {detail && (
          <>
            <header className="run-intro">
              <div>
                <p className="section-eyebrow">ACTIVE PROOF RUN</p>
                <h1>Keep the evidence in view.</h1>
                <p className="section-summary">Every event below came from this run. Select an observation to inspect the source response and payload hash.</p>
              </div>
              <div className="run-id-block">
                <span>RUN ID</span>
                <strong>{detail.run.id}</strong>
                <small>Updated {formatTimestamp(detail.run.updatedAt)}</small>
              </div>
            </header>

            <dl className="run-context">
              <div>
                <dt>Provider</dt>
                <dd>{detail.run.provider.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{modeLabel(detail.run.mode)}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{detail.run.status}</dd>
              </div>
              <div>
                <dt>Faults</dt>
                <dd>{detail.run.faultCount}</dd>
              </div>
            </dl>

            <div className="run-event-layout">
              <section className="event-rail" aria-labelledby="event-rail-title">
                <div className="run-panel-heading">
                  <p className="run-card-label">EVENT RAIL</p>
                  <h2 id="event-rail-title">What this run has seen</h2>
                </div>
                <ol className="event-list">
                  {detail.intent && (
                    <li className="event-item event-item-intent">
                      <div className="event-row-content">
                        <span className="event-index">01</span>
                        <span className="event-copy">
                          <strong>INTENT RECORDED</strong>
                          <span>{detail.intent.symbol} / {detail.intent.side} / {detail.intent.orderType}</span>
                          <small>{formatTimestamp(detail.intent.createdAt)}</small>
                        </span>
                        <span className="event-source">LOCAL</span>
                      </div>
                    </li>
                  )}
                  {observations.map((observation, index) => (
                    <li className={`event-item${observation.id === selectedObservation?.id ? " event-item-selected" : ""}${observation.faultType ? " event-item-fault" : ""}`} key={observation.id}>
                      <button className="event-select" type="button" onClick={() => setSelectedObservationId(observation.id)}>
                        <span className="event-index">{String(index + (detail.intent ? 2 : 1)).padStart(2, "0")}</span>
                        <span className="event-copy">
                          <strong>{eventLabel(observation.eventType)}</strong>
                          <span>{observation.source} / {formatTimestamp(observation.receivedAt)}</span>
                          {observation.faultType && <small>CONTROLLED FAULT / {eventLabel(observation.faultType)}</small>}
                        </span>
                        <span className="event-source">{observation.faultType ? "FAULT" : observation.source}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {!detail.intent && <p className="run-empty-state">Record an intent to start the evidence rail.</p>}
                {detail.intent && observations.length === 0 && <p className="run-empty-state">No observations have been captured for this run yet.</p>}
              </section>

              <section className="evidence-panel" aria-labelledby="evidence-panel-title">
                <div className="run-panel-heading">
                  <p className="run-card-label">CURRENT EVIDENCE</p>
                  <h2 id="evidence-panel-title">{selectedObservation ? eventLabel(selectedObservation.eventType) : "Intent record"}</h2>
                </div>
                {selectedObservation ? (
                  <>
                    <dl className="evidence-meta">
                      <div>
                        <dt>Source</dt>
                        <dd>{selectedObservation.source}</dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd>{formatTimestamp(selectedObservation.receivedAt)}</dd>
                      </div>
                      <div>
                        <dt>Evidence ID</dt>
                        <dd>{selectedObservation.id}</dd>
                      </div>
                      <div>
                        <dt>Payload hash</dt>
                        <dd>{selectedObservation.payloadHash}</dd>
                      </div>
                    </dl>
                    <pre className="evidence-payload">{JSON.stringify(selectedObservation.payload ?? { payloadHash: selectedObservation.payloadHash }, null, 2)}</pre>
                    <button className="text-link evidence-open" type="button" onClick={() => setEvidenceDrawerOpen(true)}>
                      Open raw evidence <ArrowUpRight />
                    </button>
                  </>
                ) : detail.intent ? (
                  <dl className="intent-evidence">
                    <div>
                      <dt>Symbol</dt>
                      <dd>{detail.intent.symbol}</dd>
                    </div>
                    <div>
                      <dt>Action</dt>
                      <dd>{detail.intent.side} / {detail.intent.orderType}</dd>
                    </div>
                    <div>
                      <dt>Quantity</dt>
                      <dd>{detail.intent.quantity}</dd>
                    </div>
                    <div>
                      <dt>Client order ID</dt>
                      <dd>{detail.intent.clientOrderId}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="run-empty-state">There is no intent or observation to inspect yet.</p>
                )}
              </section>
            </div>

            <section className={`run-verdict run-verdict-${verdictClass}`} aria-labelledby="verdict-title">
              <div className="verdict-topline">
                <div>
                  <p className="run-card-label">CURRENT DECISION</p>
                  <h2 id="verdict-title">{verdictHeading(reconciliationVerdict)}</h2>
                </div>
                <span className="verdict-state">{detail.reconciliation ? detail.reconciliation.verdict : detail.run.status}</span>
              </div>
              <p className="verdict-description">{verdictDescription(detail)}</p>
              {detail.incident && <p className="verdict-action"><strong>Next action</strong>{detail.incident.recommendedAction}</p>}
              {detail.aiExplanation && (
                <div className="ai-explanation">
                  <p className="run-card-label">EVIDENCE-GROUNDED EXPLANATION</p>
                  <p>{detail.aiExplanation.explanation}</p>
                </div>
              )}
              <div className="run-action-bar">
                {detail.intent ? (
                  <button className="button button-primary" type="button" onClick={() => void performAction("reconcile")} disabled={!canReconcile || screenState === "working"}>
                    {screenState === "working" ? "Checking provider state" : reconciliationVerdict ? "Reconcile again" : "Reconcile state"} <ArrowUpRight />
                  </button>
                ) : (
                  <a className="button button-primary" href={`/run/${encodeURIComponent(runId)}/intent`}>Record intent <ArrowUpRight /></a>
                )}
                <button className="button button-secondary" type="button" onClick={() => void loadDetail()} disabled={screenState === "working"}>Refresh evidence</button>
                {detail.reconciliation && <a className="button button-secondary" href={`/run/${encodeURIComponent(runId)}/receipt`}>View receipt</a>}
                {detail.reconciliation && <a className="button button-secondary" href={`/api/runs/${encodeURIComponent(runId)}/receipt.json`} download={`vurqen-${runId}.json`}>Download receipt</a>}
                {detail.incident && <a className="button button-secondary" href={`/incidents/${encodeURIComponent(detail.incident.id)}`}>Open incident</a>}
              </div>
              {actionNotice && <p className="action-notice" role="status">{actionNotice}</p>}
              {error && <p className="run-feedback run-feedback-error" role="alert">{error}</p>}

              {detail.run.mode === "replay" && (
                <>
                  <div className="replay-controls">
                    <div>
                      <p className="run-card-label">REPLAY CONTROLS</p>
                      <p>Local faults stay visibly separate from provider observations.</p>
                    </div>
                    <div className="replay-actions">
                      <button className="button button-secondary" type="button" onClick={() => void performAction("faults", { type: "drop_event", observationId: faultSource?.id })} disabled={!faultSource || screenState === "working"}>Drop event</button>
                      <button className="button button-secondary" type="button" onClick={() => void performAction("faults", { type: "duplicate_event", observationId: faultSource?.id })} disabled={!faultSource || screenState === "working"}>Duplicate event</button>
                    </div>
                  </div>
                  <form className="replay-observation-form" onSubmit={handleReplayObservation}>
                    <div className="replay-observation-heading">
                      <div>
                        <p className="run-card-label">ADD REPLAY OBSERVATION</p>
                        <p>Paste the provider-shaped evidence you want this deterministic run to inspect.</p>
                      </div>
                    </div>
                    <div className="replay-observation-fields">
                      <label className="replay-field replay-field-type">
                        <span>Event type</span>
                        <input type="text" value={replayEventType} onChange={(event) => setReplayEventType(event.target.value)} autoComplete="off" required />
                      </label>
                      <label className="replay-field replay-field-sequence">
                        <span>Sequence <em>optional</em></span>
                        <input type="number" min="0" step="1" value={replaySequence} onChange={(event) => setReplaySequence(event.target.value)} inputMode="numeric" />
                      </label>
                      <label className="replay-field replay-field-payload">
                        <span>Payload JSON</span>
                        <textarea value={replayPayload} onChange={(event) => setReplayPayload(event.target.value)} rows={7} spellCheck={false} required />
                      </label>
                    </div>
                    <button className="button button-secondary" type="submit" disabled={screenState === "working"}>Add observation <ArrowUpRight /></button>
                  </form>
                </>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p>Evidence before action.</p>
        <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
          Open source on GitHub <ArrowUpRight />
        </a>
      </footer>

      {evidenceDrawerOpen && selectedObservation && (
        <div className="evidence-drawer-layer">
          <button className="evidence-drawer-backdrop" type="button" aria-label="Close raw evidence" onClick={() => setEvidenceDrawerOpen(false)} />
          <aside className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-drawer-title">
            <div className="evidence-drawer-header">
              <div>
                <p className="run-card-label">RAW EVIDENCE</p>
                <h2 id="evidence-drawer-title">{eventLabel(selectedObservation.eventType)}</h2>
              </div>
              <button className="drawer-close" type="button" onClick={() => setEvidenceDrawerOpen(false)}>Close</button>
            </div>
            <dl className="evidence-drawer-meta">
              <div>
                <dt>Source</dt>
                <dd>{selectedObservation.source}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{formatTimestamp(selectedObservation.receivedAt)}</dd>
              </div>
              <div>
                <dt>Evidence ID</dt>
                <dd>{selectedObservation.id}</dd>
              </div>
              <div>
                <dt>Payload hash</dt>
                <dd>{selectedObservation.payloadHash}</dd>
              </div>
            </dl>
            <pre className="evidence-drawer-payload">{JSON.stringify(selectedObservation.payload ?? { payloadHash: selectedObservation.payloadHash }, null, 2)}</pre>
          </aside>
        </div>
      )}
    </div>
  );
}

type ReceiptScreenState = "loading" | "ready" | "error";

type ReceiptScreenProps = {
  runId: string;
};

function ReceiptScreen({ runId }: ReceiptScreenProps) {
  const [data, setData] = useState<{ run: Run; receipt: ReceiptRecord } | null>(null);
  const [screenState, setScreenState] = useState<ReceiptScreenState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setScreenState("loading");
    setError(null);
    void Promise.all([
      fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      }),
      fetch(`/api/runs/${encodeURIComponent(runId)}/receipt.json`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      }),
    ])
      .then(async ([runResponse, receiptResponse]) => {
        const runPayload = (await runResponse.json()) as RunDetail & { error?: string };
        const receiptPayload = (await receiptResponse.json()) as ReceiptRecord & { error?: string };
        if (!runResponse.ok || !runPayload.run) throw new Error(runPayload.error ?? `Run request failed with HTTP ${runResponse.status}`);
        if (!receiptResponse.ok || !receiptPayload.receiptId) throw new Error(receiptPayload.error ?? `Receipt request failed with HTTP ${receiptResponse.status}`);
        setData({ run: runPayload.run, receipt: receiptPayload });
        setScreenState("ready");
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setScreenState("error");
        setError(loadError instanceof Error ? loadError.message : "The receipt could not be loaded");
      });
    return () => controller.abort();
  }, [runId]);

  return (
    <div className="receipt-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p className="nav-purpose">RECEIPT</p>
        <div className="nav-actions">
          <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
            Read source <ArrowUpRight />
          </a>
        </div>
      </nav>

      <main className="receipt-main">
        <a className="setup-back" href={`/run/${encodeURIComponent(runId)}`}>Back to active run</a>
        {screenState === "loading" && <p className="screen-state-message">Loading the receipt...</p>}
        {screenState === "error" && (
          <section className="screen-error" role="alert">
            <p className="section-eyebrow">RECEIPT UNAVAILABLE</p>
            <h1>There is no portable receipt yet.</h1>
            <p>{error ?? "Record an intent and reconcile the run before requesting a receipt."}</p>
            <a className="button button-primary" href={`/run/${encodeURIComponent(runId)}`}>Open active run <ArrowUpRight /></a>
          </section>
        )}

        {data && (
          <>
            <header className="receipt-intro">
              <div>
                <p className="section-eyebrow">PORTABLE RECEIPT</p>
                <h1>Every decision has a record.</h1>
                <p className="section-summary">The receipt preserves the intent, observations, deterministic rules, and final state returned by this run.</p>
              </div>
              <div className="receipt-id-block">
                <span>RECEIPT ID</span>
                <strong>{data.receipt.receiptId}</strong>
                <small>Created {formatTimestamp(data.receipt.createdAt)}</small>
              </div>
            </header>

            <dl className="receipt-context">
              <div>
                <dt>Provider</dt>
                <dd>{data.receipt.provider.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{modeLabel(data.receipt.mode)}</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd>{data.receipt.runId}</dd>
              </div>
              <div>
                <dt>Schema</dt>
                <dd>v{data.receipt.schemaVersion}</dd>
              </div>
            </dl>

            <section className={`receipt-verdict receipt-verdict-${data.receipt.reconciliation ? data.receipt.verdict.toLowerCase().replace("_", "-") : "pending"}`} aria-labelledby="receipt-verdict-title">
              <div className="receipt-verdict-header">
                <div>
                  <p className="run-card-label">FINAL VERDICT</p>
                  <h2 id="receipt-verdict-title">{data.receipt.reconciliation ? verdictHeading(data.receipt.verdict) : "AWAITING RECONCILIATION"}</h2>
                </div>
                <span className="verdict-state">{data.receipt.reconciliation ? data.receipt.verdict : data.run.status}</span>
              </div>
              <p className="receipt-verdict-description">{receiptDescription(data.receipt)}</p>
              <dl className="receipt-stats">
                <div>
                  <dt>Observations</dt>
                  <dd>{data.receipt.observations.length}</dd>
                </div>
                <div>
                  <dt>Agent actions</dt>
                  <dd>{data.receipt.agentActions.length}</dd>
                </div>
                <div>
                  <dt>Matched fields</dt>
                  <dd>{data.receipt.reconciliation?.matchedFields.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Mismatched fields</dt>
                  <dd>{data.receipt.reconciliation?.mismatchedFields.length ?? 0}</dd>
                </div>
              </dl>
            </section>

            <div className="receipt-detail-layout">
              <section className="receipt-intent" aria-labelledby="receipt-intent-title">
                <div className="run-panel-heading">
                  <p className="run-card-label">CANONICAL INTENT</p>
                  <h2 id="receipt-intent-title">What the workflow asked for</h2>
                </div>
                <dl className="receipt-intent-details">
                  <div><dt>Symbol</dt><dd>{data.receipt.intent.symbol}</dd></div>
                  <div><dt>Action</dt><dd>{data.receipt.intent.side} / {data.receipt.intent.orderType}</dd></div>
                  <div><dt>Position side</dt><dd>{data.receipt.intent.positionSide}</dd></div>
                  <div><dt>Quantity</dt><dd>{data.receipt.intent.quantity}</dd></div>
                  {data.receipt.intent.price && <div><dt>Price</dt><dd>{data.receipt.intent.price}</dd></div>}
                  <div><dt>Client order ID</dt><dd>{data.receipt.intent.clientOrderId}</dd></div>
                </dl>
              </section>

              <section className="receipt-evidence" aria-labelledby="receipt-evidence-title">
                <div className="run-panel-heading">
                  <p className="run-card-label">OBSERVATIONS</p>
                  <h2 id="receipt-evidence-title">The evidence references</h2>
                </div>
                <ul className="receipt-observation-list">
                  {data.receipt.observations.map((observation) => (
                    <li key={observation.id}>
                      <span className="evidence-marker" aria-hidden="true" />
                      <span>
                        <strong>{eventLabel(observation.eventType)}</strong>
                        <small>{observation.source} / {formatTimestamp(observation.receivedAt)}</small>
                        <small>{observation.id}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="receipt-json" aria-labelledby="receipt-json-title">
              <details>
                <summary id="receipt-json-title">Open raw receipt JSON</summary>
                <pre>{JSON.stringify(data.receipt, null, 2)}</pre>
              </details>
            </section>

            <div className="receipt-actions">
              <a className="button button-primary" href={`/api/runs/${encodeURIComponent(runId)}/receipt.json`} download={`vurqen-${runId}.json`}>Download receipt <ArrowUpRight /></a>
              <a className="button button-secondary" href={`/run/${encodeURIComponent(runId)}`}>Open active run</a>
            </div>
          </>
        )}
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p>Evidence before action.</p>
        <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
          Open source on GitHub <ArrowUpRight />
        </a>
      </footer>
    </div>
  );
}

type IncidentScreenState = "loading" | "ready" | "error";

type IncidentScreenProps = {
  incidentId: string;
};

function IncidentScreen({ incidentId }: IncidentScreenProps) {
  const [detail, setDetail] = useState<IncidentResponse | null>(null);
  const [screenState, setScreenState] = useState<IncidentScreenState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setScreenState("loading");
    setError(null);
    void fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as IncidentResponse & { error?: string };
        if (!response.ok || !payload.incident || !payload.run || !payload.receipt) throw new Error(payload.error ?? `Incident request failed with HTTP ${response.status}`);
        setDetail(payload);
        setScreenState("ready");
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setScreenState("error");
        setError(loadError instanceof Error ? loadError.message : "The incident could not be loaded");
      });
    return () => controller.abort();
  }, [incidentId]);

  const timeline = detail
    ? [
        {
          id: detail.receipt.intent.id,
          title: "INTENT RECORDED",
          detail: `${detail.receipt.intent.symbol} / ${detail.receipt.intent.side} / ${detail.receipt.intent.orderType}`,
          source: "LOCAL",
          at: detail.receipt.intent.createdAt,
        },
        ...detail.receipt.observations.map((observation) => ({
          id: observation.id,
          title: eventLabel(observation.eventType),
          detail: observation.faultType ? `CONTROLLED FAULT / ${eventLabel(observation.faultType)}` : observation.source,
          source: observation.source,
          at: observation.receivedAt,
        })),
        ...(detail.receipt.reconciliation
          ? [{
              id: detail.receipt.reconciliation.id,
              title: verdictHeading(detail.receipt.reconciliation.verdict),
              detail: `${detail.receipt.reconciliation.localState} / ${detail.receipt.reconciliation.providerState}`,
              source: "DETERMINISTIC",
              at: detail.receipt.reconciliation.createdAt,
            }]
          : []),
        {
          id: detail.incident.id,
          title: "INCIDENT CREATED",
          detail: eventLabel(detail.incident.trigger),
          source: detail.incident.severity,
          at: detail.incident.createdAt,
        },
      ].sort((left, right) => left.at.localeCompare(right.at))
    : [];

  return (
    <div className="incident-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p className="nav-purpose">INCIDENT</p>
        <div className="nav-actions">
          <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
            Read source <ArrowUpRight />
          </a>
        </div>
      </nav>

      <main className="incident-main">
        <a className="setup-back" href={detail ? `/run/${encodeURIComponent(detail.run.id)}` : "/run/new"}>Back to active run</a>
        {screenState === "loading" && <p className="screen-state-message">Loading the incident receipt...</p>}
        {screenState === "error" && !detail && (
          <section className="screen-error" role="alert">
            <p className="section-eyebrow">INCIDENT UNAVAILABLE</p>
            <h1>We couldn’t load this incident.</h1>
            <p>{error ?? "The server did not return an incident record."}</p>
            <a className="button button-primary" href="/run/new">Start another run <ArrowUpRight /></a>
          </section>
        )}

        {detail && (
          <>
            <header className={`incident-intro incident-intro-${detail.incident.verdict.toLowerCase().replace("_", "-")}`}>
              <div>
                <p className="section-eyebrow">INCIDENT / {detail.incident.severity}</p>
                <h1>{verdictHeading(detail.incident.verdict)}</h1>
                <p className="section-summary">{detail.incident.summary}</p>
              </div>
              <div className="incident-id-block">
                <span>INCIDENT ID</span>
                <strong>{detail.incident.id}</strong>
                <small>Created {formatTimestamp(detail.incident.createdAt)}</small>
              </div>
            </header>

            <dl className="incident-context">
              <div>
                <dt>Provider</dt>
                <dd>{detail.run.provider.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{modeLabel(detail.run.mode)}</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd>{detail.run.id}</dd>
              </div>
              <div>
                <dt>Trigger</dt>
                <dd>{eventLabel(detail.incident.trigger)}</dd>
              </div>
            </dl>

            <div className="incident-layout">
              <section className="transition-panel" aria-labelledby="transition-title">
                <div className="run-panel-heading">
                  <p className="run-card-label">STATE TRANSITIONS</p>
                  <h2 id="transition-title">How the incident unfolded</h2>
                </div>
                <ol className="transition-list">
                  {timeline.map((entry, index) => (
                    <li className="transition-item" key={entry.id}>
                      <span className="transition-marker">{String(index + 1).padStart(2, "0")}</span>
                      <span className="transition-copy">
                        <strong>{entry.title}</strong>
                        <span>{entry.detail}</span>
                        <small>{formatTimestamp(entry.at)}</small>
                      </span>
                      <span className="transition-source">{entry.source}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="incident-evidence" aria-labelledby="incident-evidence-title">
                <div className="run-panel-heading">
                  <p className="run-card-label">EVIDENCE REFERENCED</p>
                  <h2 id="incident-evidence-title">The records behind the verdict</h2>
                </div>
                <ul className="incident-evidence-list">
                  {detail.incident.evidenceIds.map((evidenceId) => {
                    const observation = detail.receipt.observations.find((item) => item.id === evidenceId);
                    return (
                      <li key={evidenceId}>
                        <span className="evidence-marker" aria-hidden="true" />
                        <span className="incident-evidence-copy">
                          <strong>{observation ? eventLabel(observation.eventType) : "Evidence reference"}</strong>
                          <span>{observation ? `${observation.source} / ${formatTimestamp(observation.receivedAt)}` : "Referenced by the incident record"}</span>
                          <small>{evidenceId}</small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="evidence-digest">Receipt digest <strong>{detail.receipt.evidenceDigest}</strong></p>
              </section>
            </div>

            <section className="incident-action" aria-labelledby="incident-action-title">
              <div>
                <p className="run-card-label">NEXT ACTION</p>
                <h2 id="incident-action-title">Keep the retry path closed.</h2>
                <p>{detail.incident.recommendedAction}</p>
              </div>
              <div className="incident-action-buttons">
                <a className="button button-primary" href={`/run/${encodeURIComponent(detail.run.id)}`}>Open active run <ArrowUpRight /></a>
                <a className="button button-secondary" href={`/run/${encodeURIComponent(detail.run.id)}/receipt`}>View receipt</a>
                <a className="button button-secondary" href={`/api/incidents/${encodeURIComponent(detail.incident.id)}/receipt.json`} download={`vurqen-${detail.incident.id}.json`}>Download receipt <ArrowUpRight /></a>
              </div>
            </section>

            {detail.receipt.aiExplanation && (
              <section className="incident-explanation" aria-labelledby="incident-explanation-title">
                <p className="run-card-label">EVIDENCE-GROUNDED EXPLANATION</p>
                <h2 id="incident-explanation-title">{detail.receipt.aiExplanation.headline}</h2>
                <p>{detail.receipt.aiExplanation.explanation}</p>
                <p><strong>Next action</strong>{detail.receipt.aiExplanation.nextAction}</p>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p>Evidence before action.</p>
        <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
          Open source on GitHub <ArrowUpRight />
        </a>
      </footer>
    </div>
  );
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [runState, setRunState] = useState<RequestState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightSummary | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Health request failed with HTTP ${response.status}`);
      const payload = (await response.json()) as Health;
      if (!payload.ok) throw new Error("Vurqen health check was not ready");
      setHealth(payload);
    } catch {
      setHealth(null);
    }
  }, []);

  const createRun = useCallback(async (provider: ProviderName, mode: RunMode) => {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider, mode }),
    });
    const payload = (await response.json()) as { run?: Run; error?: string };
    if (!response.ok || !payload.run) throw new Error(payload.error ?? `Run request failed with HTTP ${response.status}`);
    return payload.run;
  }, []);

  const runPreflight = useCallback(async (provider: ProviderName, mode: RunMode) => {
    setRunState("starting");
    setRunError(null);
    setPreflight(null);
    try {
      const createdRun = await createRun(provider, mode);
      const response = await fetch(`/api/runs/${encodeURIComponent(createdRun.id)}/preflight`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as {
        run?: Run;
        provider?: ProviderName;
        mode?: RunMode;
        checks?: PreflightCheck[];
        error?: string;
      };
      if (!response.ok || !payload.checks) throw new Error(payload.error ?? `Preflight request failed with HTTP ${response.status}`);
      const nextRun = payload.run ?? createdRun;
      setPreflight({
        provider: payload.provider ?? provider,
        mode: payload.mode ?? mode,
        status: preflightStatus(payload.checks),
        checks: payload.checks,
        run: nextRun,
      });
      setRunState("created");
    } catch (error) {
      setRunState("error");
      setRunError(error instanceof Error ? error.message : "The preflight could not be completed");
    }
  }, [createRun]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const receiptMatch = window.location.pathname.match(/^\/run\/([^/]+)\/receipt\/?$/);
  if (receiptMatch) {
    return <ReceiptScreen runId={decodeURIComponent(receiptMatch[1])} />;
  }

  const incidentMatch = window.location.pathname.match(/^\/incidents\/([^/]+)\/?$/);
  if (incidentMatch) {
    return <IncidentScreen incidentId={decodeURIComponent(incidentMatch[1])} />;
  }

  const intentMatch = window.location.pathname.match(/^\/run\/([^/]+)\/intent\/?$/);
  if (intentMatch) {
    return <IntentScreen runId={decodeURIComponent(intentMatch[1])} />;
  }

  const runMatch = window.location.pathname.match(/^\/run\/([^/]+)\/?$/);
  if (runMatch) {
    return <ActiveRunScreen runId={decodeURIComponent(runMatch[1])} />;
  }

  if (window.location.pathname === "/run/new" || window.location.pathname === "/run/new/") {
    return (
      <RunSetupScreen
        health={health}
        runState={runState}
        runError={runError}
        preflight={preflight}
        onPreflight={(provider, mode) => void runPreflight(provider, mode)}
      />
    );
  }

  return (
    <div className="site-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p className="nav-purpose">PROOF CONSOLE</p>
        <div className="nav-actions">
          <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
            Read source <ArrowUpRight />
          </a>
        </div>
      </nav>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">
              When the exchange goes quiet, <span>keep the next move safe.</span>
            </h1>
            <p className="hero-summary">
              Vurqen records the intent, checks provider evidence, and stops a blind retry when the exchange cannot prove what happened.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/run/new">
                Start a proof run <ArrowUpRight />
              </a>
              <a className="text-link" href="#proof-preview">
                See the proof path <ArrowUpRight />
              </a>
            </div>
          </div>

        </section>

        <section className="proof-section" id="proof-preview" aria-labelledby="proof-title">
          <div className="section-heading">
            <p className="section-eyebrow">THE PROOF PATH</p>
            <h2 id="proof-title">A quiet exchange still leaves a trail.</h2>
            <p className="section-summary">
              Vurqen turns an uncertain order into a traceable answer, with every decision tied to provider evidence.
            </p>
          </div>

          <div className="proof-grid">
            <article className="proof-card">
              <div className="proof-card-topline">
                <span className="proof-number">01</span>
                <ProofIcon kind="intent" />
              </div>
              <h3>Record the intent</h3>
              <p>Capture the provider, mode, symbol, side, order type, quantity, and client order ID before the request begins.</p>
            </article>

            <article className="proof-card">
              <div className="proof-card-topline">
                <span className="proof-number">02</span>
                <ProofIcon kind="evidence" />
              </div>
              <h3>Collect the evidence</h3>
              <p>Keep acknowledgements, stream events, REST responses, timestamps, and sources attached to the same run.</p>
            </article>

            <article className="proof-card">
              <div className="proof-card-topline">
                <span className="proof-number">03</span>
                <ProofIcon kind="reconcile" />
              </div>
              <h3>Reconcile the gap</h3>
              <p>Compare provider state with the recorded intent and event history using deterministic reconciliation rules.</p>
            </article>

            <article className="proof-card">
              <div className="proof-card-topline">
                <span className="proof-number">04</span>
                <ProofIcon kind="receipt" />
              </div>
              <h3>Stop with a verdict</h3>
              <p>Return a clear state, then preserve the evidence path in a receipt the operator can inspect and download.</p>
            </article>
          </div>

          <p className="proof-section-note">Missing evidence never becomes a success state.</p>
        </section>

        <section className="workbench-section" aria-labelledby="workbench-title">
          <div className="workbench-copy">
            <p className="section-eyebrow">BUILT FOR THE QUIET MOMENT</p>
            <h2 id="workbench-title">When the signal drops, the record stays clear.</h2>
            <p className="section-summary">
              Vurqen gives the space between an agent intent and an exchange response a readable trail. Uncertainty stays visible, and the next action stays bounded.
            </p>
            <a className="text-link" href="#proof-preview">
              Follow the evidence path <ArrowUpRight />
            </a>
          </div>

          <div className="workbench-visual">
            <figure className="workbench-main">
              <img src="/images/vurqen-monitor.jpg" alt="Desk setup with a monitor, keyboard, and orange-toned screen" loading="lazy" />
            </figure>

            <figure className="workbench-inset">
              <img src="/images/vurqen-workbench.jpg" alt="Sunlit workshop desk with a lamp and tools" loading="lazy" />
            </figure>
          </div>
        </section>

        <section className="guardrails-section" aria-labelledby="guardrails-title">
          <div className="section-heading">
            <p className="section-eyebrow">THE SAFE DEFAULT</p>
            <h2 id="guardrails-title">The system knows when to stop.</h2>
            <p className="section-summary">
              Vurqen keeps uncertainty visible, keeps evidence close, and gives the operator a defensible next move.
            </p>
          </div>

          <div className="guardrails-grid">
            <article className="guardrail-card">
              <div className="guardrail-card-topline">
                <span className="proof-number">01</span>
                <GuardrailIcon kind="stop" />
              </div>
              <h3>No blind retries</h3>
              <p>When provider state is unknown, Vurqen blocks the next automatic action until someone can resolve the record.</p>
            </article>

            <article className="guardrail-card">
              <div className="guardrail-card-topline">
                <span className="proof-number">02</span>
                <GuardrailIcon kind="source" />
              </div>
              <h3>Evidence stays attached</h3>
              <p>Every observation keeps its source, timestamp, endpoint, and payload reference next to the decision it informs.</p>
            </article>

            <article className="guardrail-card">
              <div className="guardrail-card-topline">
                <span className="proof-number">03</span>
                <GuardrailIcon kind="receipt" />
              </div>
              <h3>Receipts stay useful</h3>
              <p>Verdicts preserve the intent, observations, reconciliation rule, and evidence digest for later review.</p>
            </article>
          </div>
        </section>

        <section className="final-cta" aria-labelledby="final-cta-title">
          <div className="final-cta-inner">
            <p className="section-eyebrow">START WITH THE RECORD</p>
            <h2 id="final-cta-title">Give every uncertain action a place to land.</h2>
            <p className="section-summary">
              Choose a provider and mode, run preflight, and keep the next move bounded by what the exchange can prove.
            </p>
            <div className="final-cta-actions">
              <a className="button button-primary" href="/run/new">
                Start a proof run <ArrowUpRight />
              </a>
              <a className="text-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
                Read the source <ArrowUpRight />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="/" aria-label="Vurqen home">
          <img className="brand-mark" src="/vurqen-mark.png" alt="" aria-hidden="true" />
          <span>vurqen</span>
        </a>
        <p>Evidence before action.</p>
        <a className="source-link" href="https://github.com/mystiquemide/vurqen" target="_blank" rel="noreferrer">
          Open source on GitHub <ArrowUpRight />
        </a>
      </footer>
    </div>
  );
}
