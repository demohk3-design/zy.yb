import { existsSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { eq, lt, and, like, sql } from "drizzle-orm";
import { sqliteDb } from "@/db/db";
import { fetchRuns, reports, keywords } from "@/db/schema";
import { config } from "@/config";

// ---------- 基础类型 ----------
export type ReportTask = { docId: number; title: string; orgName: string; pubDate: string };
export type ReportDetail = ReportTask & {
  detailUrl: string;
  fetchStatus: "ok" | "failed";
  error?: string;
  rawText: string;
  paragraphs: string[];
  bullets: string[];
  matchedKeywords: string[];
};

// ---------- 工具函数（移植自 index.ts） ----------
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getTargetDates(): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < config.fetch.recentDays; i++) {
    const target = new Date(now);
    target.setDate(now.getDate() - i);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, "0");
    const d = String(target.getDate()).padStart(2, "0");
    dates.push(`${y}/${m}/${d}/`);
  }
  return dates;
}

function normalizePubDate(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);
  if (!match) return null;
  const y = match[1] ?? "";
  const m = match[2] ?? "";
  const d = match[3] ?? "";
  return `${y}/${m.padStart(2, "0")}/${d.padStart(2, "0")}/`;
}

function dateKey(value: string): number {
  return Number(value.replace(/\D/g, ""));
}

function getReportId(report: any): number | null {
  const id = report?.docId ?? report?.id ?? report?.reportId;
  const numeric = Number(id);
  return Number.isFinite(numeric) ? numeric : null;
}

function getReportTitle(report: any): string {
  return report?.title || report?.reportName || report?.name || "";
}

function getReportOrg(report: any): string {
  return report?.orgName || report?.organName || report?.org || report?.institutionName || "";
}

function dateFilePart(value: string): string {
  return value.replace(/\//g, "-").slice(0, 10);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n");
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]*>/g, " "));
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// 免费预览摘要通常位于 aria-hidden=true 的容器里。
// 选择包含较长 ul 内容的容器，避免把导航、页脚和“你可能感兴趣”混入正文。
function extractReportContentHtml(html: string): string {
  // 该站点目前把详情页的免费预览正文放在“报告封面”图片后面的 <p> 中，
  // /view 页面则是 PDF 阅读器入口，通常只有登录/阅读提示。
  const coverIndex = html.search(/<img\b[^>]*alt\s*=\s*["']报告封面["'][^>]*>/i);
  if (coverIndex >= 0) {
    const afterCover = html.slice(coverIndex);
    const preview = afterCover.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (preview?.[1] && htmlToText(preview[1]).length > 100) {
      return preview[1];
    }
  }

  // 兼容其他报告模板：免费预览摘要可能位于 aria-hidden=true 的容器里。
  const candidates = html.match(/<div\b[^>]*aria-hidden\s*=\s*["']true["'][^>]*>[\s\S]*?<\/div>/gi) ?? [];
  const summary = candidates.find((block) => /<ul\b/i.test(block) && htmlToText(block).length > 100);
  return summary ?? html;
}
function extractParagraphs(rawText: string): string[] {
  const endMarkers = [
    "点击免费查看", "你可能感兴趣", "相关报告", "在线客服", "回到首页", "退出登录",
    "AIGC工具", "关于我们", "服务协议", "扫码关注", "我的报告",
  ];
  const paragraphs: string[] = [];
  for (const line of rawText.split("\n")) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    if (endMarkers.some((marker) => cleanLine.includes(marker))) break;
    if (cleanLine.length < 12) continue;
    if (cleanLine.includes("您的浏览器禁用了JavaScript")) continue;
    if (cleanLine.includes("免责声明") || cleanLine.includes("版权所有") || cleanLine.includes("不构成个人投资建议")) continue;
    paragraphs.push(cleanLine);
  }
  return paragraphs;
}

function extractBullets(html: string): string[] {
  const bullets: string[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const cleanText = (liMatch[1] ?? "").replace(/<[^>]*>/g, "").trim();
    if (
      cleanText.length > 20 &&
      cleanText.length < 2000 &&
      !cleanText.includes("免责声明") &&
      !cleanText.includes("不构成个人投资建议") &&
      !cleanText.includes("版权所有")
    ) {
      bullets.push(cleanText);
    }
  }

  if (bullets.length <= 3) {
    const rawLines = html.replace(/<br\s*\/?>/gi, "\n").split("\n");
    let currentBullet = "";
    let linesAppended = 0;
    const bulletStartRegex = /^[\uf075◆✦★•\-#]\s*([^：:]+)[：:](.*)/;
    const END_MARKERS = [
      "点击免费查看", "你可能感兴趣", "相关报告", "在线客服", "回到首页", "退出登录",
      "AIGC工具", "关于我们", "服务协议", "扫码关注", "我的报告",
    ];
    for (let line of rawLines) {
      const cleanLine = line.replace(/<[^>]*>/g, "").trim();
      if (!cleanLine) continue;
      const isEnd = END_MARKERS.some((marker) => cleanLine.includes(marker));
      if (isEnd) {
        if (currentBullet.trim().length > 15 && currentBullet.trim().length < 2000) {
          bullets.push(currentBullet.trim());
        }
        currentBullet = "";
        break;
      }
      const isStart = bulletStartRegex.test(cleanLine);
      if (isStart) {
        if (currentBullet.trim().length > 15 && currentBullet.trim().length < 2000) {
          bullets.push(currentBullet.trim());
        }
        currentBullet = cleanLine;
        linesAppended = 0;
      } else {
        if (currentBullet && linesAppended < 2) {
          if (cleanLine.length > 5 && !cleanLine.includes("投资咨询资格") && !cleanLine.includes("免责声明")) {
            currentBullet += "\n" + cleanLine;
            linesAppended++;
          }
        }
      }
    }
    if (currentBullet.trim().length > 15 && currentBullet.trim().length < 2000) {
      bullets.push(currentBullet.trim());
    }
  }
  return bullets;
}

function findReportsArray(obj: any): any[] {
  if (!obj) return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0] && (obj[0].title || obj[0].reportName || obj[0].name)) {
      return obj;
    }
    for (const item of obj) {
      const res = findReportsArray(item);
      if (res.length > 0) return res;
    }
  } else if (typeof obj === "object") {
    for (const key in obj) {
      const res = findReportsArray(obj[key]);
      if (res.length > 0) return res;
    }
  }
  return [];
}

// ---------- 关键词 ----------
// 默认关键词种子（首次启动 keywords 表为空时写入），按类别分组
export const DEFAULT_KEYWORD_GROUPS: Record<string, string[]> = {
  "黑色建材与铁合金": ["螺纹", "热卷", "热轧", "焦煤", "焦炭", "双焦", "锰硅", "硅铁", "玻璃", "纯碱", "铁矿"],
  "有色与新能源": ["氧化铝", "碳酸锂", "锂", "工业硅", "多晶硅", "不锈钢"],
  "能源化工": [
    "原油", "燃料油", "液化气", "LPG", "沥青", "甲醇", "PVC", "丙烯", "聚丙烯", "PP",
    "塑料", "PE", "PTA", "乙二醇", "MEG", "苯乙烯", "EB", "尿素", "烧碱", "对二甲苯",
    "PX", "纯苯", "短纤", "天然橡胶", "橡胶", "RU", "合成橡胶", "BR", "纸浆",
  ],
  "农产品与油脂饲料": [
    "豆粕", "菜粕", "豆油", "棕榈油", "菜油", "菜籽", "大豆", "黄豆", "玉米", "淀粉",
    "白糖", "棉花", "棉纱", "红枣", "生猪", "苹果", "花生", "鸡蛋",
  ],
};

export async function seedKeywordsIfEmpty() {
  const [countRes] = await sqliteDb.select({ count: sql<number>`count(*)` }).from(keywords).limit(1);
  const count = Number(countRes?.count ?? 0);
  if (count > 0) return;

  let sort = 0;
  for (const [category, list] of Object.entries(DEFAULT_KEYWORD_GROUPS)) {
    for (const kw of list) {
      await sqliteDb.insert(keywords).values({ keyword: kw, category, sort: sort++ }).onConflictDoNothing();
    }
  }
  console.log("[keywords] 已写入默认关键词种子");
}

export async function getEnabledKeywords(): Promise<string[]> {
  const rows = await sqliteDb.select().from(keywords).where(eq(keywords.enabled, true));
  return rows.map((r) => r.keyword);
}

function getMatchedKeywords(text: string, keywordList: string[]): string[] {
  const lower = text.toLowerCase();
  return keywordList.filter((kw) => lower.includes(kw.toLowerCase()));
}

// ---------- 投喂包生成（移植自 index.ts buildAiContext） ----------
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[已截断，完整内容见 JSONL 原料库]`;
}

export function buildAiContext(dateFormatted: string, details: ReportDetail[], keyword?: string): string {
  const selected = keyword
    ? details.filter((item) => item.matchedKeywords.includes(keyword))
    : details.filter((item) => item.matchedKeywords.length > 0);

  let markdown = `# 期货研报 AI 投喂包 (${dateFormatted}${keyword ? ` / ${keyword}` : ""})\n\n`;
  markdown += `* **报告日期**：${dateFormatted}\n`;
  markdown += `* **报告数量**：${selected.length}\n`;
  markdown += `* **筛选方式**：${keyword ? `命中关键词「${keyword}」` : "命中任一目标品种关键词"}\n`;
  markdown += `* **用途**：供 AI 基于已抓取研报原料进行综合分析，完整原料见同日 JSONL 文件。\n\n---\n\n`;

  for (const item of selected) {
    const snippets = item.bullets.length > 0 ? item.bullets : item.paragraphs.slice(0, 12);
    markdown += `## ${item.orgName} | ${item.title}\n\n`;
    markdown += `* **docId**：${item.docId}\n`;
    markdown += `* **来源**：${item.detailUrl}\n`;
    markdown += `* **命中关键词**：${item.matchedKeywords.join("、") || "无"}\n\n`;
    markdown += `### 原文摘取\n\n`;
    if (snippets.length === 0) {
      markdown += `> 未能抽取到有效正文片段，请查看 JSONL 中 rawText 或详情页。\n\n`;
    } else {
      for (const snippet of snippets.slice(0, 20)) {
        markdown += `* ${truncateText(snippet, 900)}\n`;
      }
      markdown += "\n";
    }
  }
  return markdown;
}

// ---------- 抓取核心 ----------
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REQUEST_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Referer": `${config.fetch.baseUrl}/`,
};

async function fetchReportList(targetDates: string[], onProgress?: (page: number, total: number) => void): Promise<ReportTask[]> {
  const targetDateSet = new Set(targetDates);
  const lastTargetDate = targetDates[targetDates.length - 1] ?? "";
  const oldestTargetKey = dateKey(lastTargetDate);
  const matchedReports: ReportTask[] = [];
  const seenDocIds = new Set<number>();
  let page = 1;
  let shouldStop = false;

  while (!shouldStop && page <= config.fetch.maxPages) {
    try {
      const res = await fetch(`${config.fetch.baseUrl}/category/${config.fetch.categoryId}?page=${page}`, {
        headers: REQUEST_HEADERS,
      });
      const text = await res.text();
      const match = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!match?.[1]) {
        console.warn(`[列表] 第 ${page} 页未找到 NEXT_DATA`);
        break;
      }
      const data = JSON.parse(match[1]);
      const reportsList = findReportsArray(data.props);
      if (reportsList.length === 0) {
        console.log("[列表] 没有更多研报，停止读取列表。");
        break;
      }
      for (const r of reportsList) {
        const pubDate = normalizePubDate(r.pubTimeStr || r.pubDate || r.publishTime || r.createTime);
        if (!pubDate) continue;
        if (dateKey(pubDate) < oldestTargetKey) {
          shouldStop = true;
          break;
        }
        if (targetDateSet.has(pubDate)) {
          const docId = getReportId(r);
          if (docId === null || seenDocIds.has(docId)) continue;
          const title = getReportTitle(r);
          const org = getReportOrg(r);
          const isBroker = !config.fetch.brokerOnly || org.includes("期货") || org === "国泰君安证券" || org === "南华研究";
          if (isBroker) {
            seenDocIds.add(docId);
            matchedReports.push({ docId, title, orgName: org, pubDate });
          }
        }
      }
    } catch (e: any) {
      console.error(`[列表] 第 ${page} 页失败:`, e.message);
    }
    page++;
    onProgress?.(page, matchedReports.length);
    await sleep(config.fetch.listDelayMs);
  }
  return matchedReports;
}

async function fetchReportDetail(report: ReportTask, keywordList: string[]): Promise<ReportDetail> {
  const detailUrl = `${config.fetch.baseUrl}/detail/${report.docId}`;
  try {
    const res = await fetch(detailUrl, { headers: REQUEST_HEADERS });
    if (!res.ok) throw new Error(`详情页 HTTP ${res.status}`);
    const html = await res.text();
    const contentHtml = extractReportContentHtml(html);
    const rawText = htmlToText(contentHtml);
    const paragraphs = extractParagraphs(rawText);
    const bullets = extractBullets(contentHtml);
    const keywordSource = [report.title, rawText, bullets.join("\n")].join("\n");
    return {
      ...report,
      detailUrl,
      fetchStatus: "ok",
      rawText,
      paragraphs,
      bullets,
      matchedKeywords: getMatchedKeywords(keywordSource, keywordList),
    };
  } catch (e: any) {
    return {
      ...report,
      detailUrl,
      fetchStatus: "failed",
      error: e.message,
      rawText: "",
      paragraphs: [],
      bullets: [],
      matchedKeywords: [],
    };
  }
}

// 与 search_list.json 对账，返回缺失数量
async function reconcileWithSearchList(listReports: ReportTask[]): Promise<number> {
  const searchListPath = config.paths.searchList;
  if (!existsSync(searchListPath)) return 0;
  try {
    const searchReports = await Bun.file(searchListPath).json();
    const listIds = new Set(listReports.map((r) => r.docId));
    const missing = searchReports.filter((r: any) => {
      const id = getReportId(r);
      return id !== null && !listIds.has(id);
    });
    const diffPath = join(config.paths.context, "download_fx_text_missing_from_list.json");
    if (missing.length > 0) {
      mkdirSync(config.paths.context, { recursive: true });
      await Bun.write(diffPath, JSON.stringify(missing, null, 2));
    }
    console.log(`[对账] search 有但列表没有: ${missing.length} 篇。`);
    return missing.length;
  } catch (e: any) {
    console.warn(`[对账] 读取 search_list.json 失败，跳过对比: ${e.message}`);
    return 0;
  }
}

// 生成 context 目录的全部产物（JSON/JSONL/通用投喂包/关键词投喂包），返回生成的投喂包文件名
async function writeContextFiles(
  dateFormatted: string,
  dayDetails: ReportDetail[],
  keywordList: string[],
): Promise<string[]> {
  mkdirSync(config.paths.context, { recursive: true });
  const generated: string[] = [];

  const detailJsonPath = join(config.paths.context, `fx_report_details_${dateFormatted}.json`);
  const detailJsonlPath = join(config.paths.context, `fx_report_details_${dateFormatted}.jsonl`);
  await Bun.write(detailJsonPath, JSON.stringify(dayDetails, null, 2));
  await Bun.write(detailJsonlPath, dayDetails.map((item) => JSON.stringify(item)).join("\n") + "\n");

  const allContextPath = join(config.paths.context, `fx_ai_context_${dateFormatted}.md`);
  await Bun.write(allContextPath, buildAiContext(dateFormatted, dayDetails));
  generated.push(`fx_ai_context_${dateFormatted}.md`);

  for (const kw of keywordList) {
    if (!dayDetails.some((item) => item.matchedKeywords.includes(kw))) continue;
    const safeKeyword = kw.replace(/[\\/:*?"<>|]/g, "_");
    const contextPath = join(config.paths.context, `fx_ai_context_${safeKeyword}_${dateFormatted}.md`);
    await Bun.write(contextPath, buildAiContext(dateFormatted, dayDetails, kw));
    generated.push(`fx_ai_context_${safeKeyword}_${dateFormatted}.md`);
  }
  return generated;
}

// 清理旧产物（保持原脚本行为：抓取前清理同类文件）
function cleanOldContextFiles() {
  if (!existsSync(config.paths.context)) return;
  const cleanPatterns = [
    /^fx_ai_context_.*\.md$/,
    /^fx_report_details_.*\.json$/,
    /^fx_report_details_.*\.jsonl$/,
    /^download_fx_text_list\.json$/,
    /^download_fx_text_missing_from_list\.json$/,
  ];
  let cleaned = 0;
  for (const fileName of readdirSync(config.paths.context)) {
    if (cleanPatterns.some((p) => p.test(fileName))) {
      try {
        unlinkSync(join(config.paths.context, fileName));
        cleaned++;
      } catch {
        // 忽略单个文件删除失败
      }
    }
  }
  console.log(`[清理] 已清理 context 旧文件 ${cleaned} 个`);
}

// 清理超过保留天数（默认 5 天）的数据库记录与 context 文件
// 过期数据无分析价值，保留最近几天即可
export async function cleanupOldData(days: number = config.retentionDays): Promise<number> {
  const cutoffDate = new Date(Date.now() - days * 86400000);
  const cutoff = dateFilePart(cutoffDate.toISOString());

  // 0. 删除详情页 HTTP 404 的历史无效记录（内容不存在，无分析价值）
  const notFoundCount = (
    await sqliteDb
      .select({ count: sql<number>`count(*)` })
      .from(reports)
      .where(and(eq(reports.fetchStatus, "failed"), like(reports.error, "%HTTP 404%")))
  )[0]?.count;
  if (notFoundCount && notFoundCount > 0) {
    await sqliteDb
      .delete(reports)
      .where(and(eq(reports.fetchStatus, "failed"), like(reports.error, "%HTTP 404%")))
      .run();
    console.log(`[清理] 已删除详情页 404 的无效记录 ${notFoundCount} 条`);
  }

  // 1. 删除数据库中的过期报告
  const countResult = await sqliteDb
    .select({ count: sql<number>`count(*)` })
    .from(reports)
    .where(lt(reports.pubDateKey, cutoff));
  const deletedDb = countResult[0]?.count ?? 0;
  if (deletedDb > 0) {
    await sqliteDb.delete(reports).where(lt(reports.pubDateKey, cutoff)).run();
  }

  // 2. 删除 context 目录中早于保留天数的产物文件
  let deletedFiles = 0;
  if (existsSync(config.paths.context)) {
    const dateInName = /_(\d{4}-\d{2}-\d{2})\.(md|jsonl?)$/;
    for (const fileName of readdirSync(config.paths.context)) {
      const datePart = fileName.match(dateInName)?.[1];
      if (datePart && datePart < cutoff) {
        try {
          unlinkSync(join(config.paths.context, fileName));
          deletedFiles++;
        } catch {
          // 忽略单个文件删除失败
        }
      }
    }
  }

  if (deletedDb > 0 || deletedFiles > 0) {
    console.log(`[清理] 已清理 ${cutoff} 前的过期数据：数据库 ${deletedDb} 条，文件 ${deletedFiles} 个`);
  }
  return deletedDb;
}

export async function runFetch(runId: number) {
  type RunPatch = Partial<typeof fetchRuns.$inferInsert>;
  const updateRun = (patch: RunPatch) => {
    sqliteDb.update(fetchRuns).set(patch).where(eq(fetchRuns.id, runId)).run();
  };

  try {
    const keywordList = await getEnabledKeywords();
    if (keywordList.length === 0) {
      throw new Error("keywords 表为空，请先配置关键词");
    }

    const targetDates = getTargetDates();
    updateRun({ phase: "list", status: "running", targetDates: JSON.stringify(targetDates), message: "正在遍历分类列表..." });

    const matchedReports = await fetchReportList(targetDates, (page, total) => {
      updateRun({ listTotal: total, message: `正在读取列表第 ${page} 页...` });
    });
    updateRun({ listTotal: matchedReports.length, message: `列表检索完毕，共 ${matchedReports.length} 篇` });

    // search_list 对账
    const searchDiff = await reconcileWithSearchList(matchedReports);
    updateRun({ searchDiff });

    // 保存列表快照
    mkdirSync(config.paths.context, { recursive: true });
    await Bun.write(join(config.paths.context, "download_fx_text_list.json"), JSON.stringify(matchedReports, null, 2));

    // 按日期分组
    const grouped: Record<string, ReportTask[]> = {};
    for (const report of matchedReports) {
      const list = grouped[report.pubDate] ?? (grouped[report.pubDate] = []);
      list.push(report);
    }

    // 下载详情并写入 DB
    updateRun({ phase: "detail", message: "开始下载详情..." });
    let okCount = 0;
    let failCount = 0;
    let keywordHits = 0;
    const dateDetails: Record<string, ReportDetail[]> = {};

    for (const [date, list] of Object.entries(grouped)) {
      const dateFormatted = dateFilePart(date);
      const dayDetails: ReportDetail[] = [];
      for (const report of list) {
        const detail = await fetchReportDetail(report, keywordList);
        // 详情页 HTTP 404：内容不存在，没必要入库，直接跳过
        if (detail.fetchStatus === "failed" && /HTTP 404/.test(detail.error ?? "")) {
          await sqliteDb.delete(reports).where(eq(reports.docId, detail.docId));
          updateRun({ message: `[跳过] 详情页不存在 [${detail.orgName}] ${detail.title}` });
          await sleep(config.fetch.detailDelayMs);
          continue;
        }
        dayDetails.push(detail);
        if (detail.fetchStatus === "ok") {
          okCount++;
          keywordHits += detail.matchedKeywords.length;
        } else {
          failCount++;
        }
        // upsert 入库
        const existing = await sqliteDb
          .select({ id: reports.id })
          .from(reports)
          .where(eq(reports.docId, detail.docId))
          .limit(1);
        const existingId = existing[0]?.id;
        const baseValues = {
          title: detail.title,
          orgName: detail.orgName,
          pubDate: detail.pubDate,
          pubDateKey: dateFormatted,
          detailUrl: detail.detailUrl,
          fetchStatus: detail.fetchStatus,
          error: detail.error ?? null,
          rawText: detail.rawText,
          paragraphs: JSON.stringify(detail.paragraphs),
          bullets: JSON.stringify(detail.bullets),
          matchedKeywords: JSON.stringify(detail.matchedKeywords),
        };
        if (existingId !== undefined) {
          await sqliteDb
            .update(reports)
            .set({ ...baseValues, runId, updatedAt: new Date() })
            .where(eq(reports.id, existingId))
            .run();
        } else {
          await sqliteDb.insert(reports).values({ ...baseValues, docId: detail.docId, runId }).run();
        }
        updateRun({ okCount, failCount, keywordHits, message: `正在下载 [${detail.orgName}] ${detail.title}` });
        await sleep(config.fetch.detailDelayMs);
      }
      dateDetails[dateFormatted] = dayDetails;
    }

    updateRun({ phase: "done", message: "正在生成投喂包..." });

    // 生成 context 文件
    let contextFiles: string[] = [];
    for (const [dateFormatted, dayDetails] of Object.entries(dateDetails)) {
      contextFiles = contextFiles.concat(await writeContextFiles(dateFormatted, dayDetails, keywordList));
    }

    updateRun({
      status: "success",
      phase: "done",
      message: `完成：${okCount} 成功 / ${failCount} 失败，命中关键词 ${keywordHits} 次`,
      finishedAt: new Date(),
    });
    console.log(`[完成] run#${runId} 抓取完成，成功 ${okCount}，失败 ${failCount}，context 文件 ${contextFiles.length} 个`);
  } catch (e: any) {
    console.error(`[失败] run#${runId}:`, e);
    sqliteDb
      .update(fetchRuns)
      .set({ status: "failed", phase: "failed", message: e.message, finishedAt: new Date() })
      .where(eq(fetchRuns.id, runId))
      .run();
  }
}

export async function startFetchRun(): Promise<number> {
  cleanOldContextFiles();
  void cleanupOldData();
  const created = (await sqliteDb
    .insert(fetchRuns)
    .values({ phase: "list", status: "running", message: "任务排队中..." })
    .returning())[0];
  if (!created) throw new Error("创建抓取任务失败");
  const runId = created.id;
  // 后台执行，不阻塞响应
  void runFetch(runId);
  return runId;
}

// 从数据库重建某日期的投喂包文件（供"重建"功能使用）
export async function rebuildContextsForDate(dateFormatted: string): Promise<string[]> {
  const keywordList = await getEnabledKeywords();
  const rows = await sqliteDb.select().from(reports).where(eq(reports.pubDateKey, dateFormatted));
  const details: ReportDetail[] = rows.map((r) => ({
    docId: r.docId,
    title: r.title,
    orgName: r.orgName,
    pubDate: r.pubDate,
    detailUrl: r.detailUrl ?? "",
    fetchStatus: r.fetchStatus as ReportDetail["fetchStatus"],
    error: r.error ?? undefined,
    rawText: r.rawText ?? "",
    paragraphs: JSON.parse(r.paragraphs ?? "[]"),
    bullets: JSON.parse(r.bullets ?? "[]"),
    matchedKeywords: JSON.parse(r.matchedKeywords ?? "[]"),
  }));
  return writeContextFiles(dateFormatted, details, keywordList);
}
