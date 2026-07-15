import * as fs from "node:fs";
import * as path from "node:path";
import type { Database, InitSqlJsStatic, SqlJsStatic } from "sql.js";
import {
  createSearchQueryUnits,
  normalizeSearchText,
  parseKnowledgeDocument,
} from "./searchEngine";

const schemaVersion = "1";
const candidateLimit = 200;

let sqlitePromise: Promise<SqlJsStatic> | undefined;

function loadSqlite(): Promise<SqlJsStatic> {
  const bundledLoader = path.join(__dirname, "sql-wasm.js");
  const bundledWasm = path.join(__dirname, "sql-wasm.wasm");
  const dependencyDirectory = path.join(process.cwd(), "node_modules", "sql.js", "dist");
  const loaderPath = fs.existsSync(bundledLoader)
    ? bundledLoader
    : path.join(dependencyDirectory, "sql-wasm.js");
  const initSqlJs = require(loaderPath) as InitSqlJsStatic;
  sqlitePromise ??= initSqlJs({
    locateFile: () => fs.existsSync(bundledWasm)
      ? bundledWasm
      : path.join(dependencyDirectory, "sql-wasm.wasm"),
  });
  return sqlitePromise;
}

export interface KnowledgeIndexStorage {
  read(): Promise<Uint8Array | undefined>;
  write(data: Uint8Array): Promise<void>;
}

export interface KnowledgeIndexSource {
  path: string;
  fingerprint: string;
  readContent(): Promise<string>;
}

export interface KnowledgeIndexSyncResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  rebuilt: boolean;
}

interface OpenedDatabase {
  database: Database;
  rebuilt: boolean;
}

function createSchema(database: Database): void {
  database.run(`
    CREATE TABLE index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE documents (
      path TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE knowledge_fts USING fts3(path, terms);
    INSERT INTO index_metadata(key, value) VALUES ('schema_version', '${schemaVersion}');
  `);
}

function schemaIsCurrent(database: Database): boolean {
  try {
    const result = database.exec(
      "SELECT value FROM index_metadata WHERE key = 'schema_version' LIMIT 1",
    );
    if (result[0]?.values[0]?.[0] !== schemaVersion) return false;
    database.exec("SELECT path, fingerprint FROM documents LIMIT 0");
    database.exec("SELECT path FROM knowledge_fts LIMIT 0");
    return true;
  } catch {
    return false;
  }
}

async function openDatabase(storage: KnowledgeIndexStorage, forceRebuild: boolean): Promise<OpenedDatabase> {
  const SQL = await loadSqlite();
  if (!forceRebuild) {
    const stored = await storage.read();
    if (stored?.length) {
      try {
        const database = new SQL.Database(stored);
        if (schemaIsCurrent(database)) return { database, rebuilt: false };
        database.close();
      } catch {
        // The index is disposable. Rebuild it from Markdown below.
      }
    }
  }

  const database = new SQL.Database();
  createSchema(database);
  return { database, rebuilt: true };
}

function queryRows(database: Database, sql: string, parameters: Array<string> = []): Array<Record<string, unknown>> {
  const statement = database.prepare(sql);
  try {
    statement.bind(parameters);
    const rows: Array<Record<string, unknown>> = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function searchableSegments(value: string): string[] {
  return normalizeSearchText(value).match(/[\p{Letter}\p{Number}]+/gu) ?? [];
}

function ngrams(value: string): string[] {
  const characters = Array.from(value);
  const tokens: string[] = [];
  for (let size = 1; size <= Math.min(3, characters.length); size += 1) {
    for (let start = 0; start <= characters.length - size; start += 1) {
      tokens.push(characters.slice(start, start + size).join(""));
    }
  }
  return tokens;
}

export function createIndexTerms(content: string): string {
  const parsed = parseKnowledgeDocument({ path: "", content });
  const source = [parsed.title, parsed.summary, ...parsed.keywords, parsed.body].join("\n");
  return [...new Set(searchableSegments(source).flatMap(ngrams))].join(" ");
}

function queryGroup(value: string): string | undefined {
  const characters = Array.from(value);
  if (!characters.length) return undefined;
  const tokens = characters.length <= 3
    ? [value]
    : Array.from({ length: characters.length - 2 }, (_, index) =>
        characters.slice(index, index + 3).join(""),
      );
  return tokens.map((token) => `"${token}"`).join(" AND ");
}

export function createFtsQuery(query: string): string | undefined {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const groups = terms.flatMap((term) => {
    const units = createSearchQueryUnits(term);
    const mixesJapaneseAndAscii = /[a-z0-9]/.test(term)
      && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term);
    if (units.some((unit) => unit.kind !== "exact") || mixesJapaneseAndAscii) {
      return units.flatMap((unit) => {
        const group = unit.kind === "exact" ? queryGroup(unit.value) : `"${unit.value}"`;
        return group ? [`(${group})`] : [];
      });
    }
    const segmentGroups = searchableSegments(term)
      .map(queryGroup)
      .filter((group): group is string => Boolean(group));
    return segmentGroups.length ? [`(${segmentGroups.join(" AND ")})`] : [];
  });
  return groups.length ? groups.join(" OR ") : undefined;
}

function readFingerprints(database: Database): Map<string, string> {
  return new Map(queryRows(database, "SELECT path, fingerprint FROM documents").map((row) => [
    String(row.path),
    String(row.fingerprint),
  ]));
}

function removeDocument(database: Database, path: string): void {
  database.run("DELETE FROM knowledge_fts WHERE path = ?", [path]);
  database.run("DELETE FROM documents WHERE path = ?", [path]);
}

function upsertDocument(database: Database, source: KnowledgeIndexSource, terms: string): void {
  removeDocument(database, source.path);
  database.run("INSERT INTO documents(path, fingerprint) VALUES (?, ?)", [
    source.path,
    source.fingerprint,
  ]);
  database.run("INSERT INTO knowledge_fts(path, terms) VALUES (?, ?)", [source.path, terms]);
}

export class SqliteKnowledgeIndex {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly storage: KnowledgeIndexStorage) {}

  sync(sources: KnowledgeIndexSource[], forceRebuild = false): Promise<KnowledgeIndexSyncResult> {
    return this.exclusive(async () => {
      const opened = await openDatabase(this.storage, forceRebuild);
      const { database } = opened;
      const result: KnowledgeIndexSyncResult = {
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: 0,
        rebuilt: opened.rebuilt,
      };

      try {
        const existing = readFingerprints(database);
        const currentPaths = new Set(sources.map((source) => source.path));
        database.run("BEGIN");
        try {
          for (const source of sources) {
            const previousFingerprint = existing.get(source.path);
            if (previousFingerprint === source.fingerprint) {
              result.unchanged += 1;
              continue;
            }
            upsertDocument(database, source, createIndexTerms(await source.readContent()));
            if (previousFingerprint === undefined) result.added += 1;
            else result.updated += 1;
          }
          for (const path of existing.keys()) {
            if (currentPaths.has(path)) continue;
            removeDocument(database, path);
            result.removed += 1;
          }
          database.run("COMMIT");
        } catch (error) {
          database.run("ROLLBACK");
          throw error;
        }

        if (opened.rebuilt || result.added || result.updated || result.removed) {
          await this.storage.write(database.export());
        }
        return result;
      } finally {
        database.close();
      }
    });
  }

  candidatePaths(query: string): Promise<string[]> {
    return this.exclusive(async () => {
      const match = createFtsQuery(query);
      if (!match) return [];
      const stored = await this.storage.read();
      if (!stored?.length) return [];
      const SQL = await loadSqlite();
      const database = new SQL.Database(stored);
      try {
        if (!schemaIsCurrent(database)) return [];
        return queryRows(
          database,
          `SELECT path FROM knowledge_fts WHERE knowledge_fts MATCH ? LIMIT ${candidateLimit}`,
          [match],
        ).map((row) => String(row.path));
      } finally {
        database.close();
      }
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}
