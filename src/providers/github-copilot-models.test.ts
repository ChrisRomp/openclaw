import { describe, expect, it } from "vitest";
import { buildCopilotModelDefinition, getDefaultCopilotModelIds } from "./github-copilot-models.js";

describe("github-copilot-models", () => {
  it("returns default model ids", () => {
    const ids = getDefaultCopilotModelIds();
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4.1");
  });

  it("throws on empty model id", () => {
    expect(() => buildCopilotModelDefinition("")).toThrow("Model id required");
    expect(() => buildCopilotModelDefinition("  ")).toThrow("Model id required");
  });

  it("claude-opus-4.6 uses openai-completions and 200k context", () => {
    const def = buildCopilotModelDefinition("claude-opus-4.6");
    expect(def.api).toBe("openai-completions");
    expect(def.contextWindow).toBe(200_000);
    expect(def.reasoning).toBe(true);
  });

  it("claude-sonnet-4.5 uses openai-completions and 200k context", () => {
    const def = buildCopilotModelDefinition("claude-sonnet-4.5");
    expect(def.api).toBe("openai-completions");
    expect(def.contextWindow).toBe(200_000);
    expect(def.reasoning).toBe(false);
  });

  it("gpt-5.3-codex uses openai-responses and 400k context", () => {
    const def = buildCopilotModelDefinition("gpt-5.3-codex");
    expect(def.api).toBe("openai-responses");
    expect(def.contextWindow).toBe(400_000);
  });

  it("gpt-5.2-codex uses openai-responses and 400k context", () => {
    const def = buildCopilotModelDefinition("gpt-5.2-codex");
    expect(def.api).toBe("openai-responses");
    expect(def.contextWindow).toBe(400_000);
  });

  it("unknown model defaults to openai-completions and 128k context", () => {
    const def = buildCopilotModelDefinition("gpt-4.1");
    expect(def.api).toBe("openai-completions");
    expect(def.contextWindow).toBe(128_000);
    expect(def.reasoning).toBe(false);
  });

  it("model id lookup is case-insensitive", () => {
    const def = buildCopilotModelDefinition("Claude-Opus-4.6");
    expect(def.api).toBe("openai-completions");
    expect(def.contextWindow).toBe(200_000);
    // id preserves original casing
    expect(def.id).toBe("Claude-Opus-4.6");
  });
});
