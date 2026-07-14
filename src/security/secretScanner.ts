export type SecretKind =
  | "private-key"
  | "github-token"
  | "aws-access-key"
  | "jwt"
  | "credential-url"
  | "credential-assignment";

export interface SecretFinding {
  kind: SecretKind;
  label: string;
  start: number;
  end: number;
}

interface SecretPattern {
  kind: SecretKind;
  label: string;
  pattern: RegExp;
}

const patterns: SecretPattern[] = [
  {
    kind: "private-key",
    label: "秘密鍵",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    kind: "github-token",
    label: "GitHubトークン",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  {
    kind: "aws-access-key",
    label: "AWSアクセスキー",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    kind: "jwt",
    label: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    kind: "credential-url",
    label: "認証情報を含むURL",
    pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/gi,
  },
  {
    kind: "credential-assignment",
    label: "認証情報らしい代入値",
    pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|client[_-]?secret)\s*[:=]\s*["']?[^\s"';&]{6,}/gi,
  },
];

export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const definition of patterns) {
    const pattern = new RegExp(definition.pattern.source, definition.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      findings.push({
        kind: definition.kind,
        label: definition.label,
        start,
        end: start + match[0].length,
      });
    }
  }
  return findings.sort((a, b) => a.start - b.start);
}

export function summarizeSecretFindings(findings: SecretFinding[]): string {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.label, (counts.get(finding.label) ?? 0) + 1);
  return [...counts.entries()].map(([label, count]) => `${label}: ${count}件`).join("、");
}

export function describeSecretFindingLocations(
  text: string,
  findings: SecretFinding[],
  limit = 5,
): string {
  const locations = findings.slice(0, limit).map((finding) => {
    const line = text.slice(0, finding.start).split(/\r?\n/).length;
    return `${finding.label}（${line}行目）`;
  });
  if (findings.length > limit) locations.push(`ほか${findings.length - limit}件`);
  return locations.join("、");
}
