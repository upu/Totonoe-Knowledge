export function createKnowledgeId(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = now.getTime().toString().slice(-6);
  return `K-${date}-${suffix}`;
}
