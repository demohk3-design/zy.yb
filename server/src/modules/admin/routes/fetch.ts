import { Elysia, t } from "elysia";
import { desc, eq, sql } from "drizzle-orm";
import { sqliteDb } from "@/db/db";
import { fetchRuns } from "@/db/schema";
import { startFetchRun } from "@/services/fetch-fx";

function toRunDto(row: any) {
  return {
    id: row.id,
    phase: row.phase,
    status: row.status,
    message: row.message,
    targetDates: JSON.parse(row.targetDates ?? "[]"),
    listTotal: row.listTotal,
    detailTotal: row.detailTotal,
    okCount: row.okCount,
    failCount: row.failCount,
    keywordHits: row.keywordHits,
    searchDiff: row.searchDiff,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

export const fetchRoutes = new Elysia({ prefix: "/fetch" })
  .post("/run", async () => {
    const runId = await startFetchRun();
    return { code: 0, data: { runId }, message: "抓取任务已启动", flag: true };
  })
  .get(
    "/runs",
    async ({ query }: any) => {
      const current = Number(query.current) || 1;
      const pageSize = Math.min(Number(query.pageSize) || 10, 100);
      const rows = await sqliteDb
        .select()
        .from(fetchRuns)
        .orderBy(desc(fetchRuns.id))
        .limit(pageSize)
        .offset((current - 1) * pageSize);
      const [countRes] = await sqliteDb.select({ count: sql<number>`count(*)` }).from(fetchRuns);
      return {
        code: 0,
        data: rows.map(toRunDto),
        total: Number(countRes?.count ?? 0),
        flag: true,
      };
    },
    {
      query: t.Object({
        current: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/runs/:id",
    async ({ set, params }) => {
      const id = Number(params.id);
      const [row] = await sqliteDb.select().from(fetchRuns).where(eq(fetchRuns.id, id)).limit(1);
      if (!row) {
        set.status = 404;
        return { code: 404, message: "任务不存在" };
      }
      return { code: 0, data: toRunDto(row), flag: true };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
