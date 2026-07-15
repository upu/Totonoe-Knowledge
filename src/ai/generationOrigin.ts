export type GenerationOrigin = "prepared" | "template" | "languageModel";

export function requiresMetadataInput(origin: GenerationOrigin): boolean {
  return origin === "template";
}
