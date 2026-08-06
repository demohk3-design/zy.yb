import { Elysia, t } from "elysia";
import { eq, desc, asc, and, or, like, sql } from "drizzle-orm";
import { sqliteDb } from "@/db/db";
import { reports } from "@/db/schema";

// 行转换：把 JSON 字符串字段解析成数组
function toReportDto(row: any) {
  return {
    id: row.id,
    docId: row.docId,
    title: row.title,
    orgName: row.orgName,
    pubDate: row.pubDate,
    pubDateKey: row.pubDateKey,
    detailUrl: row.detailUrl,
    fetchStatus: row.fetchStatus,
    error: row.error,
    runId: row.runId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paragraphs: JSON.parse(row.paragraphs ?? "[]"),
    bullets: JSON.parse(row.bullets ?? "[]"),
    matchedKeywords: JSON.parse(row.matchedKeywords ?? "[]"),
  };
}

export const reportsRoutes = new Elysia({ prefix: "/reports" })
  .get(
    "/read",
    async ({ query }: any) => {
      const current = Number(query.current) || 1;
      const pageSize = Math.min(Number(query.pageSize) || 20, 200);
      const title = typeof query.title === "string" ? query.title.trim() : "";
      const orgName = typeof query.orgName === "string" ? query.orgName.trim() : "";
      const keyword = typeof query.keyword === "string" ? query.keyword.trim() : "";
      const pubDateKey = typeof query.pubDateKey === "string" ? query.pubDateKey.trim() : "";
      const fetchStatus = typeof query.fetchStatus === "string" ? query.fetchStatus.trim() : "";
      const startDate = typeof query.startDate === "string" && query.startDate.trim() ? query.startDate.trim() : "";
      const endDate = typeof query.endDate === "string" && query.endDate.trim() ? query.endDate.trim() : "";
      const sortField = typeof query.sortField === "string" ? query.sortField : "docId";
      const sortOrder = typeof query.sortOrder === "string" ? query.sortOrder : "descend";

      const conditions: any[] = [];
      if (startDate) {
        conditions.push(sql`${reports.pubDateKey} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${reports.pubDateKey} <= ${endDate}`);
      }
      if (title) {
        conditions.push(like(reports.title, `%${title}%`));
      }
      if (orgName) {
        conditions.push(eq(reports.orgName, orgName));
      }
      if (keyword) {
        conditions.push(
          or(
            like(reports.title, `%${keyword}%`),
            like(reports.matchedKeywords, `%"${keyword}"%`),
          ),
        );
      }
      if (pubDateKey) {
        conditions.push(eq(reports.pubDateKey, pubDateKey));
      }
      if (fetchStatus) {
        conditions.push(eq(reports.fetchStatus, fetchStatus));
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // 白名单排序字段
      const sortableFields: Record<string, any> = {
        id: reports.id,
        docId: reports.docId,
        pubDateKey: reports.pubDateKey,
        orgName: reports.orgName,
        title: reports.title,
        fetchStatus: reports.fetchStatus,
      };
      const orderField = sortableFields[sortField] || reports.pubDateKey;
      const orderBy = sortOrder === "ascend" ? [asc(orderField), asc(reports.id)] : [desc(orderField), desc(reports.id)];

      const rows = await sqliteDb
        .select()
        .from(reports)
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset((current - 1) * pageSize);

      const [countRes] = await sqliteDb
        .select({ count: sql<number>`count(*)` })
        .from(reports)
        .where(whereClause);

      const list = rows.map(toReportDto).map((r) => ({
        ...r,
        rawText: undefined, // 列表不返回大字段
      }));

      return { code: 0, data: list, total: Number(countRes?.count ?? 0), flag: true };
    },
    {
      query: t.Object({
        current: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
        title: t.Optional(t.String()),
        orgName: t.Optional(t.String()),
        keyword: t.Optional(t.String()),
        pubDateKey: t.Optional(t.String()),
        fetchStatus: t.Optional(t.String()),
        startDate: t.Optional(t.String()),
        endDate: t.Optional(t.String()),
        sortField: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/detail/:docId",
    async ({ set, params }) => {
      const docId = Number(params.docId);
      const [row] = await sqliteDb.select().from(reports).where(eq(reports.docId, docId)).limit(1);
      if (!row) {
        set.status = 404;
        return { code: 404, message: "报告不存在" };
      }
      return { code: 0, data: toReportDto(row), flag: true };
    },
    {
      params: t.Object({ docId: t.String() }),
    },
  )
  .get(
    "/orgs",
    async () => {
      const rows = await sqliteDb
        .select({ orgName: reports.orgName })
        .from(reports)
        .groupBy(reports.orgName)
        .orderBy(asc(reports.orgName));
      return { code: 0, data: rows.map((r) => r.orgName), flag: true };
    },
  )
  .get(
    "/dates",
    async () => {
      const rows = await sqliteDb
        .select({ pubDateKey: reports.pubDateKey })
        .from(reports)
        .groupBy(reports.pubDateKey)
        .orderBy(desc(reports.pubDateKey));
      return { code: 0, data: rows.map((r) => r.pubDateKey), flag: true };
    },
  )
  .delete(
    "/delete/:docId",
    async ({ set, params }) => {
      const docId = Number(params.docId);
      const [existing] = await sqliteDb.select({ id: reports.id }).from(reports).where(eq(reports.docId, docId)).limit(1);
      if (!existing) {
        set.status = 404;
        return { code: 404, message: "报告不存在" };
      }
      await sqliteDb.delete(reports).where(eq(reports.id, existing.id));
      return { code: 0, data: true, flag: true };
    },
    {
      params: t.Object({ docId: t.String() }),
    },
  );
