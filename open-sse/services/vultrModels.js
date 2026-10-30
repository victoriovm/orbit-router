// Vultr Inference publishes one catalogue for every modality, so /v1/models
// mixes chat LLMs with TTS, ASR, image, video, rerank and embedding entries.
// Each entry declares input_modalities/output_modalities as arrays of objects
// ({type:"text", ...}) — older/shorter shapes may use plain strings.

const modalityTypes = (modalities) =>
  (Array.isArray(modalities) ? modalities : [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.type))
    .filter((type) => typeof type === "string");

export function isVultrChatModel(model) {
  return modalityTypes(model?.input_modalities).includes("text")
    && modalityTypes(model?.output_modalities).includes("text");
}

export function parseVultrModels(payload) {
  const raw = Array.isArray(payload)
    ? payload
    : payload?.data || payload?.models || payload?.results || [];
  return (Array.isArray(raw) ? raw : []).filter(isVultrChatModel);
}
