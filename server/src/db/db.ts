import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as sqliteSchema from "./schema";
import { config } from "@/config";

const sqliteDbPath = config.paths.sqliteDbPath;
mkdirSync(dirname(sqliteDbPath), { recursive: true });

export const sqliteConnection = new Database(sqliteDbPath);

sqliteConnection.run("PRAGMA journal_mode = WAL;");
sqliteConnection.run("PRAGMA synchronous = NORMAL;");
sqliteConnection.run("PRAGMA busy_timeout = 15000;");
sqliteConnection.run("PRAGMA foreign_keys = ON;");
sqliteConnection.run("PRAGMA temp_store = MEMORY;");
sqliteConnection.run("PRAGMA cache_size = -16384;");

export const sqliteDb = drizzle(sqliteConnection, { schema: sqliteSchema });

// 启动时建表（简化，不引入 drizzle-kit 迁移）
export function initDb() {
  sqliteConnection.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      docId INTEGER NOT NULL,
      title TEXT NOT NULL,
      orgName TEXT NOT NULL,
      pubDate TEXT NOT NULL,
      pubDateKey TEXT NOT NULL,
      detailUrl TEXT,
      fetchStatus TEXT NOT NULL DEFAULT 'ok',
      error TEXT,
      rawText TEXT,
      paragraphs TEXT,
      bullets TEXT,
      matchedKeywords TEXT,
      contextFiles TEXT,
      runId INTEGER,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  sqliteConnection.run(`
    CREATE TABLE IF NOT EXISTS fetch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase TEXT NOT NULL DEFAULT 'list',
      status TEXT NOT NULL DEFAULT 'running',
      message TEXT,
      targetDates TEXT,
      listTotal INTEGER NOT NULL DEFAULT 0,
      detailTotal INTEGER NOT NULL DEFAULT 0,
      okCount INTEGER NOT NULL DEFAULT 0,
      failCount INTEGER NOT NULL DEFAULT 0,
      keywordHits INTEGER NOT NULL DEFAULT 0,
      searchDiff INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      finishedAt INTEGER
    );
  `);
  sqliteConnection.run(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '其他',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  // 唯一索引（幂等）
  sqliteConnection.run(`CREATE UNIQUE INDEX IF NOT EXISTS reports_docId_key ON reports (docId);`);
  sqliteConnection.run(`CREATE INDEX IF NOT EXISTS reports_pubDateKey_idx ON reports (pubDateKey);`);
  sqliteConnection.run(`CREATE INDEX IF NOT EXISTS reports_orgName_idx ON reports (orgName);`);
  sqliteConnection.run(`CREATE INDEX IF NOT EXISTS fetch_runs_status_idx ON fetch_runs (status);`);
  sqliteConnection.run(`CREATE UNIQUE INDEX IF NOT EXISTS keywords_keyword_key ON keywords (keyword);`);
  sqliteConnection.run(`CREATE INDEX IF NOT EXISTS keywords_enabled_idx ON keywords (enabled);`);
}
