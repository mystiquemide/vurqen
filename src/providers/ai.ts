import { AiExplanation, AiExplanationSchema, Incident, Intent, Observation, Reconciliation } from "../core/schemas";

export type ExplanationContext = {
  intent: Intent;
  observations: Observation[];
  reconciliation?: Reconciliation;
  incident?: Incident;
};

export interface IncidentExplainer {
  readonly name: "gemini" | "groq";
  explain(context: ExplanationContext): Promise<AiExplanation>;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI response did not contain a JSON object");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function parseExplanation(value: unknown, context: ExplanationContext): AiExplanation {
  const explanation = AiExplanationSchema.parse(value);
  const validEvidenceIds = new Set(context.observations.map((observation) => observation.id));
  if (explanation.evidenceIds.some((evidenceId) => !validEvidenceIds.has(evidenceId))) {
    throw new Error("AI response referenced an unknown evidence ID");
  }
  return explanation;
}

function promptFor(context: ExplanationContext): string {
  return [
    "You are the Vurqen incident explainer.",
    "Use only the structured evidence below.",
    "Do not invent provider state, balances, order status, or evidence IDs.",
    "The deterministic reconciliation verdict is authoritative.",
    "Return JSON only with exactly these keys: headline, explanation, nextAction, evidenceIds.",
    "evidenceIds must contain only IDs present in the supplied evidence.",
    JSON.stringify(context),
  ].join("\n");
}

export class GeminiExplainer implements IncidentExplainer {
  readonly name = "gemini" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async explain(context: ExplanationContext): Promise<AiExplanation> {
    const response = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptFor(context) }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            maxOutputTokens: 500,
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const raw = await response.text();
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${raw.slice(0, 300)}`);
    const parsed = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned no explanation text");
    return parseExplanation(extractJson(text), context);
  }
}

export class GroqExplainer implements IncidentExplainer {
  readonly name = "groq" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model = "groq/compound-mini",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async explain(context: ExplanationContext): Promise<AiExplanation> {
    const response = await this.fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return JSON only. Use only supplied evidence. Never invent provider state or evidence IDs.",
          },
          { role: "user", content: promptFor(context) },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Groq HTTP ${response.status}: ${raw.slice(0, 300)}`);
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const text = parsed.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Groq returned no explanation text");
    return parseExplanation(extractJson(text), context);
  }
}

export class FallbackExplainer implements IncidentExplainer {
  readonly name: "gemini" | "groq";

  constructor(
    private readonly primary: IncidentExplainer,
    private readonly fallback?: IncidentExplainer,
  ) {
    this.name = primary.name;
  }

  async explain(context: ExplanationContext): Promise<AiExplanation> {
    try {
      return await this.primary.explain(context);
    } catch (primaryError) {
      if (!this.fallback) throw primaryError;
      return this.fallback.explain(context);
    }
  }
}
