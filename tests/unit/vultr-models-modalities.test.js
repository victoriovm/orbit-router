/**
 * Vultr Inference serves one /v1/models catalogue for every modality, so the
 * discovery route must drop TTS/ASR/image/video/rerank/embedding entries and
 * keep only models whose input_modalities and output_modalities both contain
 * "text".
 */

import { describe, expect, it } from "vitest";

import { parseVultrModels, isVultrChatModel } from "../../open-sse/services/vultrModels.js";

const model = (id, input, output) => ({
  id,
  name: id,
  input_modalities: input.map((type) => ({ type })),
  output_modalities: output.map((type) => ({ type })),
});

describe("vultr — /v1/models modality filter", () => {
  it("keeps text-in/text-out chat models", () => {
    expect(isVultrChatModel(model("glm-5.3-flash", ["text", "image"], ["text"]))).toBe(true);
    expect(isVultrChatModel(model("glm-5.3", ["text"], ["text"]))).toBe(true);
  });

  it("drops audio, image, video, rerank and embedding models", () => {
    expect(isVultrChatModel(model("chatterbox", ["text"], ["speech"]))).toBe(false);
    expect(isVultrChatModel(model("whisper-large-v3-turbo", ["audio"], ["transcription"]))).toBe(false);
    expect(isVultrChatModel(model("z-image-turbo", ["text"], ["image"]))).toBe(false);
    expect(isVultrChatModel(model("minimax-h3", ["text", "video"], ["video", "image"]))).toBe(false);
    expect(isVultrChatModel(model("qwen3-embedding-4b", ["text"], ["embeddings"]))).toBe(false);
    expect(isVultrChatModel(model("bge-reranker-v2-m3", ["text"], ["rerank"]))).toBe(false);
    expect(isVultrChatModel(model("ace-step-1.5", ["text"], ["audio"]))).toBe(false);
  });

  it("drops entries missing modality metadata entirely", () => {
    expect(isVultrChatModel({ id: "no-modalities" })).toBe(false);
    expect(isVultrChatModel({ id: "empty", input_modalities: [], output_modalities: [] })).toBe(false);
  });

  it("accepts plain-string modality entries", () => {
    expect(isVultrChatModel({ id: "legacy", input_modalities: ["text"], output_modalities: ["text"] })).toBe(true);
    expect(isVultrChatModel({ id: "legacy-tts", input_modalities: ["text"], output_modalities: ["speech"] })).toBe(false);
  });

  it("filters the payload envelope and preserves the full entry", () => {
    const payload = {
      data: [
        model("glm-5.3", ["text"], ["text"]),
        model("qwen-image-2.1", ["text", "image"], ["image"]),
        model("mimo-v2.6-pro", ["text"], ["text"]),
      ],
    };

    const kept = parseVultrModels(payload);

    expect(kept.map((m) => m.id)).toEqual(["glm-5.3", "mimo-v2.6-pro"]);
    expect(kept[0]).toMatchObject({ name: "glm-5.3" });
  });

  it("tolerates bare-array and malformed payloads", () => {
    expect(parseVultrModels([model("glm-5.2", ["text"], ["text"])]).map((m) => m.id)).toEqual(["glm-5.2"]);
    expect(parseVultrModels(null)).toEqual([]);
    expect(parseVultrModels({})).toEqual([]);
  });
});
