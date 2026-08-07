import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "@/config";
import { mdToHtml, reportHtmlPage } from "@/services/report-html";

// AI 研报生成的 system 提示词：约束输出结构，且只允许基于素材撰写
const SYSTEM_PROMPT = `你是资深的期货研究员，精通国内商品期货的基本面、技术面与资金面分析。
请根据给定的机构研报观点素材，撰写一份结构清晰、观点明确的中文期货品种研报（Markdown 格式）。要求：
1. 标题：# {品种}期货研报（{最新数据日期}）
2. 开头用一段「核心观点」综述，总结当天市场的主流判断
3. 「机构观点汇总」：按机构列出主要观点（机构名 + 要点），素材里没有的机构不要写
4. 「多空分歧」：梳理看多与看空的主要逻辑
5. 「关键价位与风险」：整理素材中提及的关键价位、风险提示
6. 「综合结论」：给出你的倾向性结论与后续关注点
只允许基于素材内容撰写，严禁编造素材中不存在的数据、机构或观点。输出完整的 Markdown 文本即可，不要输出额外说明。`;

export type GeneratedReport = {
  fileName: string;
  content: string;
};

// 读取某品种最近数日的 AI 投喂包（按日期倒序，汇总全部），调用 LLM 生成研报，并保存到 reports/ 目录
export async function generateReportWithAI(keyword: string): Promise<GeneratedReport> {
  const safeKeyword = keyword.replace(/[\\/:*?"<>|]/g, "_");
  const dir = config.paths.context;
  if (!existsSync(dir)) {
    throw new Error("context 目录不存在，请先抓取数据");
  }

  // 收集该品种所有日期的投喂包文件，按日期倒序（最新在前）
  const files = readdirSync(dir)
    .map((name) => {
      const match = name.match(/^fx_ai_context_(.+?)_(\d{4}-\d{2}-\d{2})\.md$/);
      if (!match || match[1] !== safeKeyword) return null;
      return { name, date: match[2], path: join(dir, name) };
    })
    .filter((item): item is { name: string; date: string; path: string } => item !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (files.length === 0) {
    throw new Error(`未找到品种「${keyword}」的投喂包，请先抓取数据或从数据库重建`);
  }

  // 合并所有日期的素材内容（多日数据一并喂给 AI，信息更全）
  let mergedContent = "";
  for (const file of files) {
    const content = await Bun.file(file.path).text();
    mergedContent += content.trimEnd() + "\n\n";
  }
  const coveredDates = files.map((f) => f.date);
  const latestDate = coveredDates[0];

  // 拼 OpenAI 兼容接口地址（baseUrl 可能带 /v1 也可能不带）
  const base = config.ai.baseUrl.replace(/\/+$/, "");
  const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  let content = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `品种：${keyword}\n数据覆盖日期：${coveredDates.join("、")}（最近一天 ${latestDate} 的数据时效最新，分析时以最新日期为主，多日观点可交叉印证）\n\n以下是该品种最近数日全部期货机构研报的观点素材（AI 投喂包）：\n\n${mergedContent}`,
          },
        ],
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`AI 接口错误 ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    content = json.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      throw new Error("AI 返回内容为空，请检查模型配置或重试");
    }
  } finally {
    clearTimeout(timer);
  }

  mkdirSync(config.paths.reports, { recursive: true });
  // 直接生成 HTML 文件（不再保存 .md 中间产物）
  const title = content.match(/^#\s+(.+)$/m)?.[1] ?? `${keyword}期货研报`;
  const fileName = `${safeKeyword}_${latestDate}.html`;
  const html = reportHtmlPage(title, mdToHtml(content), new Date().toLocaleString("zh-CN"));
  await Bun.write(join(config.paths.reports, fileName), html);

  return { fileName, content };
}

// 列出已生成的研报文件（按修改时间倒序）
export function listGeneratedReports(): { name: string; size: number; mtime: Date }[] {
  if (!existsSync(config.paths.reports)) return [];
  return readdirSync(config.paths.reports)
    .filter((name) => name.endsWith(".html"))
    .map((name) => {
      const stat = statSync(join(config.paths.reports, name));
      return { name, size: stat.size, mtime: new Date(stat.mtimeMs) };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

// 为历史 md 研报补齐同名 HTML 页面（旧文件无 html，补一次即可）
export function ensureReportHtml(): number {
  if (!existsSync(config.paths.reports)) return 0;
  let created = 0;
  for (const name of readdirSync(config.paths.reports)) {
    if (!name.endsWith(".md")) continue;
    const htmlName = name.replace(/\.md$/, ".html");
    if (existsSync(join(config.paths.reports, htmlName))) continue;
    try {
      const content = readFileSync(join(config.paths.reports, name), "utf8");
      const title = content.match(/^#\s+(.+)$/m)?.[1] ?? name.replace(/\.md$/, "");
      const html = reportHtmlPage(title, mdToHtml(content), "（历史报告，已自动转换）");
      writeFileSync(join(config.paths.reports, htmlName), html, "utf8");
      created++;
    } catch {
      // 单个文件失败不影响其余
    }
  }
  if (created > 0) console.log(`[研报] 已为 ${created} 份历史研报补齐 HTML 页面`);
  return created;
}
