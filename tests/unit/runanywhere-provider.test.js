import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("RunAnywhere (Wally) provider", () => {
  const entry = REGISTRY.find((e) => e.id === "runanywhere");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("runanywhere");
    expect(entry.aliases).toEqual(expect.arrayContaining(["runa", "wally"]));
  });

  it("points at the verified OpenAI-compatible base URL", () => {
    expect(PROVIDERS.runanywhere.baseUrl).toBe("https://inference.runanywhere.ai/v1/chat/completions");
    expect(PROVIDERS.runanywhere.validateUrl).toBe("https://inference.runanywhere.ai/v1/models");
    // transport.format defaults to "openai" via the shared provider default
    expect(PROVIDERS.runanywhere.format).toBe("openai");
  });

  it("uses the documented display name and the site favicon brand", () => {
    expect(entry.display.name).toBe("RunAnywhere (Wally)");
    expect(entry.display.textIcon).toBe("RA");
    expect(entry.display.website).toBe("https://www.runanywhere.ai");
  });

  it("enables dynamic model discovery and passthrough", () => {
    // Entitlement is per key and per environment, so /models for the caller's
    // own key — not a hardcoded list — is the authority on callable ids.
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://inference.runanywhere.ai/v1/models",
      type: "openai",
    });
  });

  it("seeds only the published console default model", () => {
    expect((PROVIDER_MODELS.runanywhere || []).map((m) => m.id)).toEqual(["glm-5.3-flash"]);
  });

  it("routes through the shared DefaultExecutor (no custom adapter)", () => {
    expect(getExecutor("runanywhere")).toBeInstanceOf(DefaultExecutor);
  });

  it("keeps every registry id unique after adding runanywhere", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("RunAnywhere wiring", () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), "utf8");

  it("ships a /public/providers/runanywhere.png icon", () => {
    // getProviderIconSrc() resolves /providers/{id}.png and silently falls back
    // to the textIcon tile when the file 404s.
    expect(existsSync(join(REPO_ROOT, "public", "providers", "runanywhere.png"))).toBe(true);
  });

  it("registers the provider in the /models resolver", () => {
    // Without this entry the route answers 400 "Provider runanywhere does not
    // support models listing" and live discovery fails once a key is saved.
    const source = read("src", "app", "api", "providers", "[id]", "models", "route.js");
    const line = source.split("\n").find((l) => l.trim().startsWith("runanywhere: createOpenAIModelsConfig("));
    expect(line).toBeTruthy();
    expect(line).toContain("https://inference.runanywhere.ai/v1/models");
  });

  it("tests the saved key against the provider's own /models endpoint", () => {
    const source = read("src", "app", "api", "providers", "[id]", "test", "testUtils.js");
    const cases = source.split("\n").find((l) => l.includes('case "runanywhere"'));
    expect(cases).toBeTruthy();
  });
});