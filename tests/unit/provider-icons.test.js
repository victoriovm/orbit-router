// Guards the class of bug that shipped twice: a visible provider whose icon
// silently falls back to the textIcon tile because /public/providers/{id}.png
// is missing. getProviderIconSrc() returns a path unconditionally and the
// <img> onError path is invisible, so the regression reaches users unnoticed.
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { resolveProviderIconId } from "../../src/shared/utils/providerIcon.js";

const iconPath = (id) => fileURLToPath(new URL(`../../public/providers/${id}.png`, import.meta.url));

describe("provider icons", () => {
  it("resolves an existing PNG for every provider the dashboard renders", () => {
    // Hidden providers are not listed in the dashboard, so their icon is optional.
    const visible = REGISTRY.filter((e) => !e.hidden);
    const missing = visible
      .filter((e) => !existsSync(iconPath(resolveProviderIconId(e.id))))
      .map((e) => `${e.id} (display: ${e.display?.name ?? "none"})`);

    expect(missing, `providers without a resolvable icon PNG: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the OpenCode family on its shared brand icon", () => {
    // opencode-zen shipped without a PNG while its sibling opencode-go had one.
    for (const id of ["opencode", "opencode-go", "opencode-zen"]) {
      expect(existsSync(iconPath(id)), `${id}.png is missing`).toBe(true);
    }
  });

  it("routes aliased ids to the alias target's PNG", () => {
    // ICON_ALIASES entries deliberately have no PNG of their own; the alias
    // target must exist or the fallback tile shows instead.
    for (const id of ["ollama-search", "perplexity-agent", "gitlab-duo", "vercel-ai-gateway"]) {
      const target = resolveProviderIconId(id);
      expect(target, `${id} did not resolve to an alias target`).not.toBe(id);
      expect(existsSync(iconPath(target)), `${id} -> ${target}.png is missing`).toBe(true);
    }
  });
});