import assert from "node:assert/strict";
import test from "node:test";
import {
  SqliteKnowledgeIndex,
  createFtsQuery,
  createIndexTerms,
  type KnowledgeIndexSource,
  type KnowledgeIndexStorage,
} from "./sqliteIndex";

class MemoryStorage implements KnowledgeIndexStorage {
  data: Uint8Array | undefined;

  async read(): Promise<Uint8Array | undefined> {
    return this.data ? new Uint8Array(this.data) : undefined;
  }

  async write(data: Uint8Array): Promise<void> {
    this.data = new Uint8Array(data);
  }
}

const markdown = (title: string, summary: string, body: string) => `---
id: K-20260715-001
title: "${title}"
summary: "${summary}"
type: investigation
status: active
keywords:
  - "SSH"
  - "PTY"
created_at: 2026-07-15T00:00:00.000Z
updated_at: 2026-07-15T00:00:00.000Z
related: []
supersedes: []
---

# 結論

${body}
`;

function source(
  path: string,
  fingerprint: string,
  content: string,
  onRead?: () => void,
): KnowledgeIndexSource {
  return {
    path,
    fingerprint,
    readContent: async () => {
      onRead?.();
      return content;
    },
  };
}

test("creates safe FTS queries for Japanese, ASCII, and punctuation", () => {
  assert.equal(createFtsQuery("PTY 端末幅"), '("pty") OR ("端末幅")');
  assert.equal(createFtsQuery("Kubernetes"), '("kub" AND "ube" AND "ber" AND "ern" AND "rne" AND "net" AND "ete" AND "tes")');
  assert.equal(createFtsQuery("ERR-123"), '("err" AND "123")');
  assert.equal(createFtsQuery("  !!!  "), undefined);
  assert.equal(createFtsQuery("🔐"), undefined);
});

test("indexes substrings without storing the original Markdown", () => {
  const terms = createIndexTerms(markdown(
    "SSHログが80文字で折り返される原因",
    "PTYの端末幅を変更する",
    "COLUMNSではなくsttyを使う。",
  ));
  assert.match(terms, /端末幅/);
  assert.match(terms, /stt/);
  assert.doesNotMatch(terms, /created_at/);
});

test("rebuilds, searches Japanese and ASCII substrings, and survives index deletion", async () => {
  const storage = new MemoryStorage();
  const index = new SqliteKnowledgeIndex(storage);
  const sources = [source(
    "knowledge/investigations/K-001.md",
    "1:100",
    markdown("SSHログが折り返される原因", "PTYの端末幅を変更する", "stty colsを使用する。"),
  )];

  const first = await index.sync(sources);
  assert.equal(first.rebuilt, true);
  assert.equal(first.added, 1);
  assert.deepEqual(await index.candidatePaths("端末幅"), [sources[0].path]);
  assert.deepEqual(await index.candidatePaths("TTY"), [sources[0].path]);

  storage.data = undefined;
  assert.deepEqual(await index.candidatePaths("端末幅"), []);
  const rebuilt = await index.sync(sources);
  assert.equal(rebuilt.rebuilt, true);
  assert.deepEqual(await index.candidatePaths("端末幅"), [sources[0].path]);
});

test("incrementally reads only added or changed Markdown and removes deleted paths", async () => {
  const storage = new MemoryStorage();
  const index = new SqliteKnowledgeIndex(storage);
  let reads = 0;
  const first = source("knowledge/K-001.md", "1:100", markdown("Alpha", "First", "Body"), () => { reads += 1; });

  await index.sync([first]);
  assert.equal(reads, 1);
  const unchanged = await index.sync([first]);
  assert.equal(unchanged.unchanged, 1);
  assert.equal(reads, 1);

  const changed = source("knowledge/K-001.md", "2:101", markdown("Beta", "Second", "Body"), () => { reads += 1; });
  const second = source("knowledge/K-002.md", "1:90", markdown("Gamma", "Third", "Body"), () => { reads += 1; });
  const updated = await index.sync([changed, second]);
  assert.equal(updated.updated, 1);
  assert.equal(updated.added, 1);
  assert.equal(reads, 3);
  assert.deepEqual(await index.candidatePaths("Beta"), [changed.path]);

  const removed = await index.sync([second]);
  assert.equal(removed.removed, 1);
  assert.deepEqual(await index.candidatePaths("Beta"), []);
});

test("replaces a corrupt disposable index from Markdown", async () => {
  const storage = new MemoryStorage();
  storage.data = new Uint8Array([1, 2, 3, 4]);
  const index = new SqliteKnowledgeIndex(storage);
  const entry = source("knowledge/K-001.md", "1:10", markdown("Recovery", "Recovered", "Body"));

  const result = await index.sync([entry]);
  assert.equal(result.rebuilt, true);
  assert.equal(result.added, 1);
  assert.deepEqual(await index.candidatePaths("Recovery"), [entry.path]);
});
