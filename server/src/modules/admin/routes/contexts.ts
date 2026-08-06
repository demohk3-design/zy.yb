import { Elysia, t } from "elysia";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { config } from "@/config";
import { rebuildContextsForDate } from "@/services/fetch-fx";

// 列出 context 目录中的产物文件（按修改时间倒序）
export const contextsRoutes = new Elysia({ prefix: "/contexts" })
  .get("/read", async () => {
    const dir = config.paths.context;
    if (!existsSync(dir)) {
      return { code: 0, data: [], flag: true };
    }
    const files = readdirSync(dir)
      .filter((name) => /^fx_(ai_context|report_details)_/.test(name))
      .map((name) => {
        const fullPath = join(dir, name);
        const stat = statSync(fullPath);
        return {
          name,
          size: stat.size,
          mtime: new Date(stat.mtimeMs),
          kind: name.startsWith("fx_ai_context_") ? "context" : "detail",
        };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return { code: 0, data: files, flag: true };
  })
  .get(
    "/content",
    async ({ query, set }: any) => {
      const fileName = typeof query.file === "string" ? query.file : "";
      if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
        set.status = 400;
        return { code: 400, message: "文件名非法" };
      }
      const fullPath = join(config.paths.context, fileName);
      if (!existsSync(fullPath)) {
        set.status = 404;
        return { code: 404, message: "文件不存在" };
      }
      const content = await Bun.file(fullPath).text();
      return { code: 0, data: { name: basename(fullPath), content }, flag: true };
    },
    {
      query: t.Object({ file: t.Optional(t.String()) }),
    },
  )
  .post(
    "/rebuild",
    async ({ set, body }: any) => {
      const dateFormatted = typeof body.dateFormatted === "string" ? body.dateFormatted.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFormatted)) {
        set.status = 400;
        return { code: 400, message: "dateFormatted 格式应为 YYYY-MM-DD" };
      }
      try {
        const files = await rebuildContextsForDate(dateFormatted);
        return { code: 0, data: { files }, message: `已重建 ${dateFormatted} 的投喂包 ${files.length} 个`, flag: true };
      } catch (e: any) {
        set.status = 500;
        return { code: 500, message: e.message };
      }
    },
    {
      body: t.Object({ dateFormatted: t.String() }),
    },
  );
