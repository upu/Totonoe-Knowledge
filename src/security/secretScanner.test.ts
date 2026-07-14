import assert from "node:assert/strict";
import test from "node:test";
import {
  describeSecretFindingLocations,
  scanForSecrets,
  summarizeSecretFindings,
} from "./secretScanner";

test("detects representative secret formats without returning their values", () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  const findings = scanForSecrets(`token=${secret}\npassword=very-secret-value`);

  assert.ok(findings.some((finding) => finding.kind === "github-token"));
  assert.ok(findings.some((finding) => finding.kind === "credential-assignment"));
  assert.equal(JSON.stringify(findings).includes(secret), false);
});

test("detects private keys and credential URLs", () => {
  const findings = scanForSecrets([
    "-----BEGIN PRIVATE KEY-----",
    "postgresql://admin:secret-password@example.invalid/db",
  ].join("\n"));

  assert.deepEqual(findings.map((finding) => finding.kind), ["private-key", "credential-url"]);
  assert.equal(summarizeSecretFindings(findings), "秘密鍵: 1件、認証情報を含むURL: 1件");
  assert.equal(
    describeSecretFindingLocations([
      "-----BEGIN PRIVATE KEY-----",
      "postgresql://admin:secret-password@example.invalid/db",
    ].join("\n"), findings),
    "秘密鍵（1行目）、認証情報を含むURL（2行目）",
  );
});

test("does not flag ordinary technical prose", () => {
  assert.deepEqual(scanForSecrets("パスワードをログへ出力しない。API keyの保存方法を検討する。"), []);
});
