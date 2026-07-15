export interface ComparableVersion {
  prefix: string;
  segments: number[];
}

function normalizePrefix(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .replace(/[\s_-]+$/g, "");
}

export function parseComparableVersion(value: string): ComparableVersion | undefined {
  const normalized = value.normalize("NFKC").trim();
  const match = normalized.match(/^(.*?)(?:v)?(\d+(?:\.\d+)*)$/i);
  if (!match) return undefined;
  const segments = match[2].split(".").map(Number);
  if (segments.some((segment) => !Number.isSafeInteger(segment))) return undefined;
  return { prefix: normalizePrefix(match[1]), segments };
}

export function compareComparableVersions(
  left: ComparableVersion,
  right: ComparableVersion,
): number | undefined {
  if (left.prefix !== right.prefix) return undefined;
  const length = Math.max(left.segments.length, right.segments.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.segments[index] ?? 0) - (right.segments[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function compareVersionStrings(left: string, right: string): number | undefined {
  const parsedLeft = parseComparableVersion(left);
  const parsedRight = parseComparableVersion(right);
  if (!parsedLeft || !parsedRight) return undefined;
  return compareComparableVersions(parsedLeft, parsedRight);
}

export function isVersionInRange(
  version: string,
  appliesFrom?: string,
  appliesTo?: string,
): boolean {
  const target = parseComparableVersion(version);
  if (!target) return false;
  const from = appliesFrom?.trim() ? parseComparableVersion(appliesFrom) : undefined;
  const to = appliesTo?.trim() ? parseComparableVersion(appliesTo) : undefined;
  if (appliesFrom?.trim() && !from) return false;
  if (appliesTo?.trim() && !to) return false;
  if (from) {
    const comparison = compareComparableVersions(target, from);
    if (comparison === undefined || comparison < 0) return false;
  }
  if (to) {
    const comparison = compareComparableVersions(target, to);
    if (comparison === undefined || comparison > 0) return false;
  }
  return true;
}

export function describeVersionRange(appliesFrom?: string, appliesTo?: string): string {
  const from = appliesFrom?.trim();
  const to = appliesTo?.trim();
  if (from && to) return `${from}〜${to}`;
  if (from) return `${from}以降`;
  if (to) return `${to}まで`;
  return "全バージョン";
}
