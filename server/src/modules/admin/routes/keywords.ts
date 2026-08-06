import { Elysia, t } from "elysia";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import { sqliteDb } from "@/db/db";
import { keywords } from "@/db/schema";

export const keywordsRoutes = new Elysia({ prefix: "/keywords" })
  .get(
    "/read",
    async ({ query }: any) => {
      const current = Number(query.current) || 1;
      const pageSize = Math.min(Number(query.pageSize) || 20, 200);
      const keyword = typeof query.keyword === "string" ? query.keyword.trim() : "";
      const category = typeof query.category === "string" ? query.category.trim() : "";
      const enabled = typeof query.enabled === "string" ? query.enabled.trim() : "";

      const conditions: any[] = [];
      if (keyword) conditions.push(sql`keyword LIKE ${`%${keyword}%`}`);
      if (category) conditions.push(eq(keywords.category, category));
      if (enabled === "true" || enabled === "false") {
        conditions.push(eq(keywords.enabled, enabled === "true"));
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await sqliteDb
        .select()
        .from(keywords)
        .where(whereClause)
        .orderBy(asc(keywords.sort), asc(keywords.id))
        .limit(pageSize)
        .offset((current - 1) * pageSize);
      const [countRes] = await sqliteDb.select({ count: sql<number>`count(*)` }).from(keywords).where(whereClause);

      return { code: 0, data: rows, total: Number(countRes?.count ?? 0), flag: true };
    },
    {
      query: t.Object({
        current: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
        keyword: t.Optional(t.String()),
        category: t.Optional(t.String()),
        enabled: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/add",
    async ({ set, body }: any) => {
      const kw = String(body.keyword || "").trim();
      if (!kw) {
        set.status = 400;
        return { code: 400, message: "关键词不能为空" };
      }
      const existing = await sqliteDb.select({ id: keywords.id }).from(keywords).where(eq(keywords.keyword, kw)).limit(1);
      if (existing.length > 0) {
        set.status = 400;
        return { code: 400, message: "关键词已存在" };
      }
      const [created] = await sqliteDb
        .insert(keywords)
        .values({
          keyword: kw,
          category: String(body.category || "其他").trim(),
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
          sort: body.sort !== undefined ? Number(body.sort) : 0,
        })
        .returning();
      return { code: 0, data: created, flag: true };
    },
    {
      body: t.Object({
        keyword: t.String(),
        category: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        sort: t.Optional(t.Union([t.Number(), t.String()])),
      }),
    },
  )
  .put(
    "/edit/:id",
    async ({ set, params, body }: any) => {
      const id = Number(params.id);
      const [existing] = await sqliteDb.select().from(keywords).where(eq(keywords.id, id)).limit(1);
      if (!existing) {
        set.status = 404;
        return { code: 404, message: "关键词不存在" };
      }
      const [updated] = await sqliteDb
        .update(keywords)
        .set({
          keyword: body.keyword !== undefined ? String(body.keyword).trim() : undefined,
          category: body.category !== undefined ? String(body.category).trim() : undefined,
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
          sort: body.sort !== undefined ? Number(body.sort) : undefined,
        })
        .where(eq(keywords.id, id))
        .returning();
      return { code: 0, data: updated, flag: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        keyword: t.Optional(t.String()),
        category: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        sort: t.Optional(t.Union([t.Number(), t.String()])),
      }),
    },
  )
  .delete(
    "/delete/:id",
    async ({ set, params }) => {
      const id = Number(params.id);
      const [existing] = await sqliteDb.select({ id: keywords.id }).from(keywords).where(eq(keywords.id, id)).limit(1);
      if (!existing) {
        set.status = 404;
        return { code: 404, message: "关键词不存在" };
      }
      await sqliteDb.delete(keywords).where(eq(keywords.id, id));
      return { code: 0, data: true, flag: true };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
