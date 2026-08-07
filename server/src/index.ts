import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config";
import { initDb, sqliteDb, sqliteConnection } from "./db/db";
import { seedKeywordsIfEmpty, cleanupOldData } from "./services/fetch-fx";
import { ensureReportHtml } from "./services/ai";
import { adminRoutes } from "./modules/admin";

initDb();
void seedKeywordsIfEmpty();
void cleanupOldData();
void ensureReportHtml();

export const app = new Elysia()
  .decorate("db", sqliteDb)
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { code: 400, message: "参数校验失败", flag: false };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { code: 404, message: "接口不存在", flag: false };
    }
    console.error("Unhandled Error:", error);
    return { code: 500, message: "服务器内部错误", flag: false };
  })
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/admin")) return;
    // 简单访问日志
    console.log(`[admin] ${request.method} ${url.pathname}`);
  })
  .use(
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Accept-Language"],
    }),
  )
  .use(adminRoutes)
  // 静态服务：AI 生成的研报 HTML（新窗口直接打开）
  .get("/reports/:file", ({ params, set }) => {
    const file = params.file;
    if (!/^[\w\u4e00-\u9fa5_-]+\.html$/.test(file)) {
      set.status = 400;
      return "非法文件名";
    }
    const reportsRoot = resolve(config.paths.reports);
    const filePath = resolve(reportsRoot, file);
    if (!filePath.startsWith(reportsRoot) || !existsSync(filePath)) {
      set.status = 404;
      return "文件不存在";
    }
    set.headers["content-type"] = "text/html; charset=utf-8";
    return Bun.file(filePath);
  })
  .get("/health", async () => {
    try {
      sqliteDb.run(sql`SELECT 1`);
      return { ok: true, db: true };
    } catch (error) {
      console.error("Health check failed", error);
      return { ok: false, db: false };
    }
  })
  .listen({ port: config.port, hostname: "0.0.0.0" }, () => {
    console.log(`[fx-admin] server listening on http://127.0.0.1:${config.port}`);
  });

let shuttingDown = false;
const gracefulShutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[fx-admin] received ${signal}, shutting down...`);
  const forceExitTimer = setTimeout(() => {
    console.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 5000);
  forceExitTimer.unref?.();
  try {
    await app.stop?.();
    sqliteConnection.close();
  } catch (error) {
    console.error("stop failed", error);
  } finally {
    clearTimeout(forceExitTimer);
    process.exit(0);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export type App = typeof app;
