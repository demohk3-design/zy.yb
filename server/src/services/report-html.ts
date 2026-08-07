// 简易 Markdown → HTML 渲染 + 研报 HTML 页面模板
// 覆盖 AI 研报常用的标题 / 列表 / 加粗 / 表格 / 段落 / 代码块

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inList = false;
  let listTag: "ul" | "ol" | null = null;
  let inCode = false;
  let codeLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  const closeList = () => {
    if (inList && listTag) {
      html.push(`</${listTag}>`);
      inList = false;
      listTag = null;
    }
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const rows = tableRows.map((r) =>
      r
        .split("|")
        .map((c) => c.trim())
        .filter((c, i, arr) => !(i === arr.length - 1 && c === "")),
    );
    // 去掉表头分隔行（---）
    const body = rows.filter((r) => !r.every((c) => /^-{1,}$/.test(c)));
    let t = "<table><thead><tr>";
    const headerRow = body[0];
    if (headerRow) {
      t += headerRow.map((c) => `<th>${inline(c)}</th>`).join("");
    }
    t += "</tr></thead><tbody>";
    for (const row of body.slice(1)) {
      t += "<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
    }
    t += "</tbody></table>";
    html.push(t);
    tableRows = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(esc(line));
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      if (!inTable) {
        flushTable();
        inTable = true;
      }
      tableRows.push(line);
      continue;
    }
    if (inTable) {
      flushTable();
      inTable = false;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        inList = true;
        listTag = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (/^\s*\d+[.、]\s+/.test(line)) {
      if (!inList) {
        inList = true;
        listTag = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inline(line.replace(/^\s*\d+[.、]\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  flushTable();
  if (inCode) html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);

  return html.join("\n");
}

const PAGE_STYLE = `
* { box-sizing: border-box; }
body {
  margin: 0;
  background: linear-gradient(180deg, #eef2f7 0%, #e7ecf3 100%);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  color: #24292f;
  line-height: 1.8;
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid #e5e7eb;
}
.toolbar button {
  border: 1px solid #d0d5dd;
  background: #fff;
  color: #374151;
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all .2s;
}
.toolbar button:hover { border-color: #1677ff; color: #1677ff; }
.toolbar .brand { font-size: 13px; color: #6b7280; }
.page {
  max-width: 900px;
  margin: 28px auto 64px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 6px 28px rgba(15, 23, 42, 0.08);
  padding: 44px 56px 56px;
}
.meta {
  font-size: 13px;
  color: #9ca3af;
  margin: 8px 0 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f1f3;
}
h1 {
  font-size: 26px;
  margin: 0 0 4px;
  color: #111827;
  letter-spacing: .5px;
}
h2 {
  font-size: 19px;
  margin: 34px 0 12px;
  padding-left: 12px;
  border-left: 4px solid #1677ff;
  color: #111827;
}
h3 { font-size: 16px; margin: 24px 0 8px; color: #1f2937; }
h4 { font-size: 15px; color: #374151; }
p { margin: 10px 0; }
ul, ol { padding-left: 26px; margin: 10px 0; }
li { margin: 5px 0; }
li::marker { color: #1677ff; }
strong { color: #b42318; font-weight: 600; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
th {
  background: #f0f5ff;
  color: #1d39c4;
  text-align: left;
}
th, td { border: 1px solid #e5e7eb; padding: 8px 12px; }
tr:nth-child(even) td { background: #fafbfc; }
code {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: "SFMono-Regular", Consolas, monospace;
}
pre {
  background: #1f2937;
  color: #e5e7eb;
  padding: 16px 20px;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}
blockquote {
  margin: 14px 0;
  padding: 10px 16px;
  border-left: 4px solid #f59e0b;
  background: #fffbeb;
  color: #78350f;
  border-radius: 0 8px 8px 0;
}
@media (max-width: 720px) {
  .page { margin: 12px; padding: 24px 20px; }
  h1 { font-size: 21px; }
}
@media print {
  .toolbar { display: none; }
  body { background: #fff; }
  .page { box-shadow: none; margin: 0; border-radius: 0; }
}
`;

export function reportHtmlPage(title: string, contentHtml: string, generatedAt: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="toolbar">
  <button onclick="history.back()">← 返回</button>
  <span class="brand">期货研报管理系统</span>
  <button onclick="window.print()">打印 / 保存 PDF</button>
</div>
<div class="page">
  ${contentHtml}
  <div class="meta">生成时间：${esc(generatedAt)} ｜ 数据来源：fxbaogao 机构研报聚合</div>
</div>
</body>
</html>`;
}
