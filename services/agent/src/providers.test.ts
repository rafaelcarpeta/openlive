import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OPENLIVE_DATA_DIR = mkdtempSync(join(tmpdir(), "openlive-prov-"));

const { setSetting } = await import("@openlive/db");
const { resolveLive } = await import("./providers");

// A local provider is keyless — picking it must not fall through to a keyed
// default the user never chose (issue #13: Ollama → "No API key for Anthropic").
describe("resolveLive", () => {
  beforeAll(async () => { await setSetting("liveProviderId", "ollama"); await setSetting("liveModel", "qwen3:8b"); });

  it("honours a keyless provider with no API keys configured", () => {
    const { provider, model, apiKey } = resolveLive();
    expect(provider.id).toBe("ollama");
    expect(provider.keyless).toBe(true);
    expect(model).toBe("qwen3:8b");
    expect(apiKey).toBeNull();
  });
});
