import { randomBytes } from "node:crypto";

export function createKnowledgeId(now: Date, entropy = randomBytes(2).toString("hex")): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 23).replaceAll(":", "").replace(".", "");
  return `K-${date}-${time}-${entropy}`;
}
