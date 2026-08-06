import { Elysia, t } from "elysia";
import { sql, desc } from "drizzle-orm";
import { sqliteDb } from "@/db/db";
import { reports, fetchRuns } from "@/db/schema";
import { config } from "@/config";

const RECENT_DAYS = 14;

function lastNDateKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return keys;
}

// 生成 start ~ end（含）之间的所有日期键
function rangeDateKeys(start: string, end: string): string[] {
  const keys: string[] = [];
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return keys;
}

export const dashboardRoutes = new Elysia().get(
  "/dashboard/stats",
  async ({ query }) => {
    const startDate = typeof query.startDate === "string" && query.startDate ? query.startDate : null;
    const endDate = typeof query.endDate === "string" && query.endDate ? query.endDate : null;

    // 范围日期键；未传范围时默认近 14 天（与旧行为一致）
    const dateKeys =
      startDate && endDate ? rangeDateKeys(startDate, endDate) : lastNDateKeys(RECENT_DAYS);
    const dateIn = sql`pubDateKey IN (${sql.join(dateKeys.map((k) => sql`${k}`), sql`, `)})`;
    // 统计口径：未传范围时按全量（旧行为）；传了范围则按范围过滤
    const whereClause = startDate && endDate ? dateIn : undefined;
    const todayKey = lastNDateKeys(1)[0] ?? "";

    // 总量（范围内）
    const [totalRes] = await sqliteDb
      .select({ count: sql<number>`count(*)`, ok: sql<number>`sum(case when fetchStatus='ok' then 1 else 0 end)` })
      .from(reports)
      .where(whereClause);

    // 按日期分布（范围）
    const byDateRows = await sqliteDb
      .select({ pubDateKey: reports.pubDateKey, count: sql<number>`count(*)` })
      .from(reports)
      .where(dateIn)
      .groupBy(reports.pubDateKey);

    const byDate = Object.fromEntries(dateKeys.map((k) => [k, 0]));
    for (const row of byDateRows) {
      byDate[row.pubDateKey] = Number(row.count);
    }

    // 机构数 & 最新抓取日期（范围内）
    const [orgRes] = await sqliteDb
      .select({ count: sql<number>`count(distinct orgName)` })
      .from(reports)
      .where(whereClause);
    const [maxDateRes] = await sqliteDb
      .select({ max: sql<string>`max(pubDateKey)` })
      .from(reports)
      .where(whereClause);

    // 关键词命中 Top（范围内报告的 matchedKeywords）
    const recentRows = await sqliteDb
      .select({ matchedKeywords: reports.matchedKeywords })
      .from(reports)
      .where(dateIn);
    const keywordCounts: Record<string, number> = {};
    for (const row of recentRows) {
      try {
        const list = JSON.parse(row.matchedKeywords ?? "[]") as string[];
        for (const kw of list) keywordCounts[kw] = (keywordCounts[kw] ?? 0) + 1;
      } catch {
        // 忽略解析失败
      }
    }
    const topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([keyword, count]) => ({ keyword, count }));

    // 最近抓取任务
    const [latestRun] = await sqliteDb.select().from(fetchRuns).orderBy(desc(fetchRuns.id)).limit(1);

    return {
      code: 0,
      data: {
        total: Number(totalRes?.count ?? 0),
        ok: Number(totalRes?.ok ?? 0),
        todayCount: byDate[todayKey] ?? 0,
        orgCount: Number(orgRes?.count ?? 0),
        latestDate: maxDateRes?.max ?? null,
        byDate,
        topKeywords,
        latestRun,
        contextDir: config.paths.context,
      },
      flag: true,
    };
  },
  {
    query: t.Object({
      startDate: t.Optional(t.String()),
      endDate: t.Optional(t.String()),
    }),
  },
);
