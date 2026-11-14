import { env } from "./env";
import { fetchSource } from "./http";

// Provider abstraction: swap Gemini for another free model by adding a class
// that implements AIProvider and returning it from getAIProvider().

export interface AIProvider {
  readonly name: string;
  available(): boolean;
  generateJson(system: string, user: string, cacheKey: string): Promise<unknown>;
}

class GeminiProvider implements AIProvider {
  readonly name = `Google Gemini (${env.geminiModel})`;
  available() {
    return !!env.geminiKey;
  }
  async generateJson(system: string, user: string, cacheKey: string) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 4096 },
    });
    const r = await fetchSource<{ candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: unknown }>(url, {
      source: "gemini",
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey! },
      ttlSeconds: 60 * 60 * 12,
      cacheKey: `ai:${cacheKey}`,
      timeoutMs: 60_000,
      retries: 1,
    });
    const text = r.data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error("Empty AI response");
    return JSON.parse(text.replace(/^```json\s*|```$/g, ""));
  }
}

class NoProvider implements AIProvider {
  readonly name = "none";
  available() {
    return false;
  }
  async generateJson(): Promise<never> {
    throw new Error("No AI provider configured");
  }
}

export function getAIProvider(): AIProvider {
  const g = new GeminiProvider();
  return g.available() ? g : new NoProvider();
}
