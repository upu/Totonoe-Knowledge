export function isValidRepositoryPath(value: string): boolean {
  const normalized = value.trim().replaceAll("\\", "/");
  return Boolean(normalized)
    && !normalized.startsWith("/")
    && !/^[a-z]:/i.test(normalized)
    && !normalized.split("/").includes("..");
}
