export type FrontmatterValue = string | string[];

export interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  values: Record<string, FrontmatterValue>;
  keyLines: Record<string, number>;
  duplicateKeys: Array<{ key: string; line: number }>;
  body: string;
}

function parseValue(raw: string): FrontmatterValue {
  const value = raw.trim();
  if (value === "[]") return [];
  if (value.startsWith('"') || value.startsWith("[") || value === "null") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
    } catch {
      // Keep malformed YAML-like values as strings so validation can report their shape.
    }
  }
  return value.replace(/^"|"$/g, "");
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { hasFrontmatter: false, values: {}, keyLines: {}, duplicateKeys: [], body: content };
  }

  const lines = match[1].split(/\r?\n/);
  const values: Record<string, FrontmatterValue> = {};
  const keyLines: Record<string, number> = {};
  const duplicateKeys: Array<{ key: string; line: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const keyMatch = lines[index].match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!keyMatch) continue;
    const [, key, raw = ""] = keyMatch;
    const line = index + 1;
    if (Object.hasOwn(values, key)) duplicateKeys.push({ key, line });
    keyLines[key] = line;

    if (raw.trim()) {
      values[key] = parseValue(raw);
      continue;
    }

    const list: string[] = [];
    while (index + 1 < lines.length) {
      const listMatch = lines[index + 1].match(/^\s+-\s+(.+)$/);
      if (!listMatch) break;
      const parsed = parseValue(listMatch[1]);
      list.push(typeof parsed === "string" ? parsed : listMatch[1].trim());
      index += 1;
    }
    values[key] = list;
  }

  return {
    hasFrontmatter: true,
    values,
    keyLines,
    duplicateKeys,
    body: content.slice(match[0].length),
  };
}

export function frontmatterString(parsed: ParsedFrontmatter, key: string): string | undefined {
  const value = parsed.values[key];
  return typeof value === "string" ? value : undefined;
}

export function frontmatterList(parsed: ParsedFrontmatter, key: string): string[] | undefined {
  const value = parsed.values[key];
  return Array.isArray(value) ? value : undefined;
}
