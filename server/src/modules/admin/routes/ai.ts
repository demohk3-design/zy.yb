import { Elysia, t } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "@/config";
import { generateReportWithAI, listGeneratedReports } from "@/services/ai";

// AI 研报生成：按品种+日期，读取投喂包 → 调 LLM → 存 reports/ 并返回内容
export const aiRoutes = new Elysia({ prefix: "/ai" })
  .post(
    "/generate",
    async ({ body, set }) => {
      const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
      if (!keyword) {
        set.status = 400;
        return { code: 400, message: "参数错误：需要 keyword（品种）" };
      }
      const aliases = Array.isArray(body.aliases)
        ? body.aliases.filter((a): a is string => typeof a === "string")
        : [];
      try {
        const result = await generateReportWithAI(keyword, aliases);
        return { code: 0, data: result, message: `已生成 ${result.fileName}`, flag: true };
      } catch (e: any) {
        set.status = 500;
        return { code: 500, message: e.message };
      }
    },
    {
      body: t.Object({
        keyword: t.String(),
        aliases: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .get("/files", async () => {
    return { code: 0, data: listGeneratedReports(), flag: true };
  })
  .get(
    "/content",
    async ({ query, set }: any) => {
      const fileName = typeof query.name === "string" ? query.name : "";
      if (!fileName.endsWith(".md") || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
        set.status = 400;
        return { code: 400, message: "文件名非法" };
      }
      const fullPath = join(config.paths.reports, fileName);
      if (!existsSync(fullPath)) {
        set.status = 404;
        return { code: 404, message: "文件不存在" };
      }
      const content = await Bun.file(fullPath).text();
      return { code: 0, data: { name: fileName, content }, flag: true };
    },
    {
      query: t.Object({ name: t.Optional(t.String()) }),
    },
  );
