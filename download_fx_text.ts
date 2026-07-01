import { join } from "node:path";
import { existsSync, readdirSync, unlinkSync } from "node:fs";

// 关注的商品/品种关键字，尽量全面以匹配多机构的不同称呼
const TARGET_KEYWORDS = [
  // 黑色建材与铁合金
  "螺纹", "热卷", "热轧", "焦煤", "焦炭", "双焦", "锰硅", "硅铁", "玻璃", "纯碱", "铁矿",
  // 有色与新能源
  "氧化铝", "碳酸锂", "锂", "工业硅", "多晶硅", "不锈钢",
  // 能源化工
  "原油", "燃料油", "液化气", "LPG", "沥青", "甲醇", "PVC", "丙烯", "聚丙烯", "PP", "塑料", "PE", "PTA", "乙二醇", "MEG", "苯乙烯", "EB", "尿素", "烧碱", "对二甲苯", "PX", "纯苯", "短纤", "天然橡胶", "橡胶", "RU", "合成橡胶", "BR", "纸浆",
  // 农产品与油脂饲料
  "豆粕", "菜粕", "豆油", "棕榈油", "菜油", "菜籽", "大豆", "黄豆", "玉米", "淀粉", "白糖", "棉花", "棉纱", "红枣", "生猪", "苹果", "花生", "鸡蛋"
];

const BASE_URL = "https://www.fxbaogao.com";
const CATEGORY_ID = 20;
const MAX_PAGES = 300;
const OUTPUT_DIR = existsSync(join(process.cwd(), "context")) ? join(process.cwd(), "context") : process.cwd();

// 辅助睡眠函数，防止请求过快被风控
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 获取需要抓取的日期列表：今天和昨天
function getTargetDates(): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i <= 1; i++) {
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

  const [, y, m, d] = match;
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
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractParagraphs(rawText: string): string[] {
  const endMarkers = ["点击免费查看", "你可能感兴趣", "相关报告", "在线客服", "回到首页", "退出登录", "AIGC工具", "关于我们", "服务协议", "扫码关注", "我的报告"];
  const paragraphs: string[] = [];

  for (const line of rawText.split("\n")) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    if (endMarkers.some(marker => cleanLine.includes(marker))) break;
    if (cleanLine.length < 12) continue;
    if (cleanLine.includes("免责声明") || cleanLine.includes("版权所有") || cleanLine.includes("不构成个人投资建议")) continue;
    paragraphs.push(cleanLine);
  }

  return paragraphs;
}

function getMatchedKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return TARGET_KEYWORDS.filter(kw => lower.includes(kw.toLowerCase()));
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[已截断，完整内容见 JSONL 原料库]`;
}

// 递归查找 Next.js data 中的报告数组
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
  } else if (typeof obj === 'object') {
    for (const key in obj) {
      const res = findReportsArray(obj[key]);
      if (res.length > 0) return res;
    }
  }
  return [];
}

// 根据 HTML 格式自适应提取观点列表
function extractBullets(html: string): string[] {
  const bullets: string[] = [];
  
  // 1. 首先尝试匹配 <li> 标签 (适用于瑞达、东证)
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const cleanText = liMatch[1].replace(/<[^>]*>/g, '').trim();
    // 过滤掉较短、过长(排版垃圾)、或免责声明内容
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

  // 2. 如果 li 匹配结果较少（如广发整篇大文本结构），采用换行和 <br> 分割整篇 HTML 进行匹配
  if (bullets.length <= 3) {
    const rawLines = html.replace(/<br\s*\/?>/gi, '\n').split('\n');
    let currentBullet = "";
    let linesAppended = 0;
    
    // 匹配标头，支持 private use area unicode 符号 \uf075
    const bulletStartRegex = /^[\uf075◆✦★•\-#]\s*([^：:]+)[：:](.*)/;
    
    const END_MARKERS = [
      "点击免费查看", "你可能感兴趣", "相关报告", "在线客服", "回到首页", "退出登录", 
      "AIGC工具", "关于我们", "服务协议", "扫码关注", "我的报告"
    ];

    for (let line of rawLines) {
      // 剥离 HTML 标签再进行匹配
      const cleanLine = line.replace(/<[^>]*>/g, '').trim();
      if (!cleanLine) continue;
      
      // 遇到页脚或系统提示，立即截断并停止解析当前页面
      const isEnd = END_MARKERS.some(marker => cleanLine.includes(marker));
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
        linesAppended = 0; // 重置计数器
      } else {
        if (currentBullet) {
          if (linesAppended < 2) {
            if (cleanLine.length > 5 && !cleanLine.includes("投资咨询资格") && !cleanLine.includes("免责声明")) {
              currentBullet += "\n" + cleanLine;
              linesAppended++;
            }
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

// 检查观点是否包含我们关心的期货商品关键字
function matchesKeywords(text: string): boolean {
  return TARGET_KEYWORDS.some(kw => text.includes(kw));
}

// 分离核心指标数据和分析逻辑观点
function formatBulletsIntoSections(bullets: string[]): string {
  const dataBullets: string[] = [];
  const logicBullets: string[] = [];

  for (const bullet of bullets) {
    const isData = /期货市场|现货市场|现货价格|库存数据|替代品价格|基差|仓单|价差|开工率|开机率|产量|销量|出口量|进口量/i.test(bullet);
    // 同时过滤非目标商品的噪音观点
    if (matchesKeywords(bullet)) {
      if (isData) {
        dataBullets.push(bullet);
      } else {
        logicBullets.push(bullet);
      }
    }
  }

  let sectionMarkdown = "";
  if (dataBullets.length > 0) {
    sectionMarkdown += `**📊 核心数据指标**\n`;
    sectionMarkdown += dataBullets.map(b => `*   ${b}`).join("\n") + "\n\n";
  }
  if (logicBullets.length > 0) {
    sectionMarkdown += `**💡 核心逻辑与展望**\n`;
    sectionMarkdown += logicBullets.map(b => `*   ${b}`).join("\n") + "\n\n";
  }

  return sectionMarkdown;
}

type ReportTask = { docId: number; title: string; orgName: string; pubDate: string };

type ReportDetail = ReportTask & {
  detailUrl: string;
  fetchStatus: "ok" | "failed";
  error?: string;
  rawText: string;
  paragraphs: string[];
  bullets: string[];
  matchedKeywords: string[];
};

async function fetchReportDetail(report: ReportTask): Promise<ReportDetail> {
  const detailUrl = `${BASE_URL}/detail/${report.docId}`;

  try {
    const res = await fetch(detailUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    const html = await res.text();
    const rawText = htmlToText(html);
    const paragraphs = extractParagraphs(rawText);
    const bullets = extractBullets(html);
    const keywordSource = [report.title, rawText, bullets.join("\n")].join("\n");

    return {
      ...report,
      detailUrl,
      fetchStatus: "ok",
      rawText,
      paragraphs,
      bullets,
      matchedKeywords: getMatchedKeywords(keywordSource)
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
      matchedKeywords: []
    };
  }
}

function buildAiContext(dateFormatted: string, details: ReportDetail[], keyword?: string): string {
  const selected = keyword
    ? details.filter(item => item.matchedKeywords.includes(keyword))
    : details.filter(item => item.matchedKeywords.length > 0);

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

async function main() {
  const listOnly = process.argv.includes("--list-only");
  const rebuildContextsOnly = process.argv.includes("--rebuild-contexts");

  if (rebuildContextsOnly) {
    const disabledContextPattern = /^fx_ai_context_(铜|铝|锌|铅|镍|锡)_\d{4}-\d{2}-\d{2}\.md$/;
    for (const fileName of readdirSync(OUTPUT_DIR)) {
      if (disabledContextPattern.test(fileName)) {
        unlinkSync(join(OUTPUT_DIR, fileName));
      }
    }

    for (const file of ["fx_report_details_2026-07-01.json", "fx_report_details_2026-06-30.json"]) {
      const detailsPath = join(OUTPUT_DIR, file);
      if (!existsSync(detailsPath)) continue;
      const details = await Bun.file(detailsPath).json() as ReportDetail[];
      const rebuilt = details.map(item => ({
        ...item,
        matchedKeywords: getMatchedKeywords([item.title, item.rawText, item.bullets.join("\n")].join("\n"))
      }));
      const dateFormatted = file.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
      if (!dateFormatted) continue;

      await Bun.write(detailsPath, JSON.stringify(rebuilt, null, 2));
      await Bun.write(join(OUTPUT_DIR, file.replace(".json", ".jsonl")), rebuilt.map(item => JSON.stringify(item)).join("\n") + "\n");
      await Bun.write(join(OUTPUT_DIR, `fx_ai_context_${dateFormatted}.md`), buildAiContext(dateFormatted, rebuilt));

      for (const keyword of TARGET_KEYWORDS) {
        if (!rebuilt.some(item => item.matchedKeywords.includes(keyword))) continue;
        const safeKeyword = keyword.replace(/[\\/:*?"<>|]/g, "_");
        const contextPath = join(OUTPUT_DIR, `fx_ai_context_${safeKeyword}_${dateFormatted}.md`);
        await Bun.write(contextPath, buildAiContext(dateFormatted, rebuilt, keyword));
      }

      console.log(`[✓] 已重建 ${dateFormatted} 的详情关键词和 AI 投喂包。`);
    }
    return;
  }

  const targetDates = getTargetDates();
  const targetDateSet = new Set(targetDates);
  const oldestTargetKey = dateKey(targetDates[targetDates.length - 1]);
  console.log("多机构走列表抓取 - 目标日期:", targetDates);

  const matchedReports: ReportTask[] = [];
  const seenDocIds = new Set<number>();
  let page = 1;
  let shouldStop = false;

  console.log("\n[🔍] 正在遍历 Category 20 列表寻找符合条件的研报...");

  while (!shouldStop && page <= MAX_PAGES) {
    console.log(`正在读取列表第 ${page} 页...`);
    try {
      const res = await fetch(`${BASE_URL}/category/${CATEGORY_ID}?page=${page}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const text = await res.text();

      const match = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!match) {
        console.warn(`第 ${page} 页未找到 NEXT_DATA`);
        break;
      }

      const data = JSON.parse(match[1]);
      const reports = findReportsArray(data.props);

      if (reports.length === 0) {
        console.log("没有更多研报，停止读取列表。");
        break;
      }

      for (const r of reports) {
        const pubDate = normalizePubDate(r.pubTimeStr || r.pubDate || r.publishTime || r.createTime);
        if (!pubDate) continue;

        // 如果发现报告日期比我们目标日期中最老的还要老，说明后面无需再翻页了
        if (dateKey(pubDate) < oldestTargetKey) {
          shouldStop = true;
          break;
        }

        if (targetDateSet.has(pubDate)) {
          const docId = getReportId(r);
          if (docId === null || seenDocIds.has(docId)) continue;

          const title = getReportTitle(r);
          const org = getReportOrg(r);
          const isBroker = org.includes("期货") || org === "国泰君安证券" || org === "南华研究";

          if (isBroker) {
            seenDocIds.add(docId);
            matchedReports.push({
              docId,
              title,
              orgName: org,
              pubDate
            });
          }
        }
      }
    } catch (e: any) {
      console.error(`读取列表第 ${page} 页失败:`, e.message);
    }

    page++;
    await sleep(300);
  }

  console.log(`\n[✓] 列表检索完毕。共筛选出 ${matchedReports.length} 篇符合条件的期货机构报告。`);
  const listPath = join(process.cwd(), "context", "download_fx_text_list.json");
  await Bun.write(listPath, JSON.stringify(matchedReports, null, 2));
  console.log(`[✓] 列表抓取结果已保存至: ${listPath}`);

  const searchListPath = join(process.cwd(), "search_list.json");
  if (existsSync(searchListPath)) {
    try {
      const searchReports = await Bun.file(searchListPath).json();
      const listIds = new Set(matchedReports.map(r => r.docId));
      const searchIds = new Set(
        searchReports
          .map((r: any) => getReportId(r))
          .filter((id: number | null): id is number => id !== null)
      );
      const missingFromList = searchReports.filter((r: any) => {
        const id = getReportId(r);
        return id !== null && !listIds.has(id);
      });
      const extraInList = matchedReports.filter(r => !searchIds.has(r.docId));

      console.log(`[对账] search_list.json: ${searchIds.size} 篇；列表抓取: ${listIds.size} 篇。`);
      console.log(`[对账] search 有但列表没有: ${missingFromList.length} 篇；列表有但 search 没有: ${extraInList.length} 篇。`);

      if (missingFromList.length > 0) {
        const diffPath = join(process.cwd(), "context", "download_fx_text_missing_from_list.json");
        await Bun.write(diffPath, JSON.stringify(missingFromList, null, 2));
        console.log(`[对账] 缺失明细已保存至: ${diffPath}`);
      }
    } catch (e: any) {
      console.warn(`[对账] 读取 search_list.json 失败，跳过对比: ${e.message}`);
    }
  }

  if (listOnly) {
    console.log("\n已启用 --list-only，仅验证列表抓取与 search_list.json 对账，不下载详情正文。");
    return;
  }

  // 按日期归类，然后按机构归类
  const grouped: Record<string, Record<string, typeof matchedReports>> = {};
  for (const date of targetDates) {
    grouped[date] = {};
  }

  for (const report of matchedReports) {
    const date = report.pubDate;
    if (!grouped[date]) continue;
    if (!grouped[date][report.orgName]) {
      grouped[date][report.orgName] = [];
    }
    grouped[date][report.orgName].push(report);
  }

  // 确保 context 目录存在
  const fs = require("node:fs");
  const contextDir = join(process.cwd(), "context");
  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
  }

  // 遍历目标日期，依次生成汇总文件
  for (const date of targetDates) {
    const dateFormatted = date.replace(/\//g, "-").slice(0, 10);
    const orgGroup = grouped[date] || {};
    const orgNames = Object.keys(orgGroup).sort();

    if (orgNames.length === 0) {
      console.log(`日期 ${dateFormatted} 没有匹配到任何研报，跳过。`);
      continue;
    }

    console.log(`\n=========================================`);
    console.log(`正在下载详情日期：${dateFormatted} (包含 ${orgNames.length} 家机构)`);
    console.log(`=========================================`);
    const dayDetails: ReportDetail[] = [];

    for (const orgName of orgNames) {
      console.log(`\n[🏛️] 正在下载 [${orgName}] 的研报详情...`);

      const reports = orgGroup[orgName];
      for (const report of reports) {
        console.log(`   -> 正在下载: [${report.docId}] ${report.title}`);
        const detail = await fetchReportDetail(report);
        dayDetails.push(detail);

        if (detail.fetchStatus === "ok") {
          console.log(`      [✓] 原文 ${detail.rawText.length} 字，段落 ${detail.paragraphs.length} 条，观点 ${detail.bullets.length} 条，命中 ${detail.matchedKeywords.length} 个关键词。`);
        } else {
          console.error(`      [x] 下载失败: ${detail.error}`);
        }

        await sleep(350);
      }
    }

    const detailJsonPath = join(contextDir, `fx_report_details_${dateFormatted}.json`);
    const detailJsonlPath = join(contextDir, `fx_report_details_${dateFormatted}.jsonl`);
    await Bun.write(detailJsonPath, JSON.stringify(dayDetails, null, 2));
    await Bun.write(detailJsonlPath, dayDetails.map(item => JSON.stringify(item)).join("\n") + "\n");
    console.log(`\n[✓] 详情原料 JSON 已保存至: ${detailJsonPath}`);
    console.log(`[✓] 详情原料 JSONL 已保存至: ${detailJsonlPath}`);

    const allContextPath = join(contextDir, `fx_ai_context_${dateFormatted}.md`);
    await Bun.write(allContextPath, buildAiContext(dateFormatted, dayDetails));
    console.log(`[✓] AI 通用投喂包已保存至: ${allContextPath}`);

    for (const keyword of TARGET_KEYWORDS) {
      if (!dayDetails.some(item => item.matchedKeywords.includes(keyword))) continue;
      const safeKeyword = keyword.replace(/[\\/:*?"<>|]/g, "_");
      const contextPath = join(contextDir, `fx_ai_context_${safeKeyword}_${dateFormatted}.md`);
      await Bun.write(contextPath, buildAiContext(dateFormatted, dayDetails, keyword));
    }
  }

  console.log("\n多机构列表式研报汇总任务全部完成！");
}

main().catch(console.error);
