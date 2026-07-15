export interface StoredRepositorySelection {
  version: 1;
  uri: string;
}

export function decodeRepositorySelection(value: unknown): StoredRepositorySelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<StoredRepositorySelection>;
  if (candidate.version !== 1 || typeof candidate.uri !== "string") return undefined;
  try {
    const parsed = new URL(candidate.uri);
    if (!parsed.protocol || !parsed.pathname.startsWith("/")) return undefined;
  } catch {
    return undefined;
  }
  return { version: 1, uri: candidate.uri };
}
