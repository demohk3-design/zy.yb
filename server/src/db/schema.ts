import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// 已抓取的研报（每篇唯一 docId）
export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: integer("docId").notNull(),
    title: text("title").notNull(),
    orgName: text("orgName").notNull(),
    // 原文列表日期，如 2026/08/06/
    pubDate: text("pubDate").notNull(),
    // 格式化日期键，如 2026-08-06，便于筛选
    pubDateKey: text("pubDateKey").notNull(),
    detailUrl: text("detailUrl"),
    fetchStatus: text("fetchStatus").notNull().default("ok"), // ok | failed
    error: text("error"),
    rawText: text("rawText"),
    // JSON 数组字符串
    paragraphs: text("paragraphs"),
    bullets: text("bullets"),
    matchedKeywords: text("matchedKeywords"),
    // 命中的投喂包文件名（JSON 数组），如 ["fx_ai_context_2026-08-06.md"]
    contextFiles: text("contextFiles"),
    runId: integer("runId"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("reports_docId_key").on(table.docId),
    index("reports_pubDateKey_idx").on(table.pubDateKey),
    index("reports_orgName_idx").on(table.orgName),
  ],
);

// 抓取任务记录（支持前端轮询进度）
export const fetchRuns = sqliteTable(
  "fetch_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // list | detail | done | failed
    phase: text("phase").notNull().default("list"),
    // running | success | failed
    status: text("status").notNull().default("running"),
    message: text("message"),
    targetDates: text("targetDates"), // JSON 数组
    listTotal: integer("listTotal").notNull().default(0),
    detailTotal: integer("detailTotal").notNull().default(0),
    okCount: integer("okCount").notNull().default(0),
    failCount: integer("failCount").notNull().default(0),
    keywordHits: integer("keywordHits").notNull().default(0),
    searchDiff: integer("searchDiff").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    finishedAt: integer("finishedAt", { mode: "timestamp" }),
  },
  (table) => [index("fetch_runs_status_idx").on(table.status)],
);

// 目标品种关键词（可配置）
export const keywords = sqliteTable(
  "keywords",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    keyword: text("keyword").notNull(),
    category: text("category").notNull().default("其他"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("keywords_keyword_key").on(table.keyword),
    index("keywords_enabled_idx").on(table.enabled),
  ],
);
