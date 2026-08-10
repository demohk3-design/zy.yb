import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// 轻量 .env 加载（仅注入尚未存在的变量）
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf8");
  for (const rawLine of envContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value.replace(/^["']|["']$/g, "");
  }
}
const env = process.env;

const serverRoot = process.cwd();

export const config = {
  isDev: env.NODE_ENV !== "production",
  port: Number(env.PORT) || 3100,

  // 数据保留天数：超过该天数的报告/投喂包自动清理（过期数据无分析价值）
  retentionDays: Number(env.RETENTION_DAYS) || 5,

  // 抓取配置（移植自原 index.ts）
  fetch: {
    baseUrl: "https://www.fxbaogao.com",
    categoryId: 20,
    maxPages: 300,
    // 列表/详情请求间隔，避免风控
    listDelayMs: 300,
    detailDelayMs: 350,
    // 抓取最近 N 天（原脚本为今天+昨天 => 2）
    recentDays: Number(env.FETCH_RECENT_DAYS) || 2,
    // 是否仅抓取期货机构
    brokerOnly: true,
  },

  // AI 研报生成（OpenAI 兼容接口，可通过环境变量覆盖）
  ai: {
    // 注意：密钥请优先通过环境变量 OPENAI_API_KEY 提供，避免提交到 git
    apiKey: env.OPENAI_API_KEY || "",
    baseUrl: env.AI_BASE_URL || "https://one-model.com",
    // 账号可用模型（/v1/models）：mimo-v2.5 / ling-3.0-flash / deepseek-v4-flash
    model: env.AI_MODEL || "deepseek-v4-flash",
  },

  paths: {
    root: serverRoot,
    // 项目根目录的报告规范；生成报告时每次读取，修改规范无需重启服务
    agentGuide: env.AGENT_GUIDE_PATH
      ? resolve(env.AGENT_GUIDE_PATH)
      : resolve(serverRoot, "../agent.md"),
    // 投喂包/原料输出目录（原脚本输出到项目根 context/）
    context: env.CONTEXT_DIR
      ? resolve(env.CONTEXT_DIR)
      : resolve(serverRoot, "../context"),
    // AI 生成的研报输出目录（与早期纯碱/硅铁研报同目录）
    reports: env.REPORTS_DIR
      ? resolve(env.REPORTS_DIR)
      : resolve(serverRoot, "../reports"),
    // search_list.json 对账文件位置（项目根目录）
    searchList: env.SEARCH_LIST_PATH
      ? resolve(env.SEARCH_LIST_PATH)
      : resolve(serverRoot, "../search_list.json"),
    // sqlite 数据文件
    sqliteDbPath: env.SQLITE_DB_PATH
      ? resolve(env.SQLITE_DB_PATH)
      : resolve(serverRoot, "../data/fx.db"),
  },
} as const;
