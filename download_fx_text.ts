import { join } from "node:path";

// 关注的商品/品种关键字，尽量全面以匹配多机构的不同称呼
const TARGET_KEYWORDS = [
  // 黑色建材与铁合金
  "螺纹", "热卷", "热轧", "焦煤", "焦炭", "双焦", "锰硅", "硅铁", "玻璃", "纯碱", "铁矿",
  // 有色与新能源
  "氧化铝", "碳酸锂", "锂", "工业硅", "多晶硅", "不锈钢", "铜", "铝", "锌", "铅", "镍", "锡",
  // 能源化工
  "原油", "燃料油", "液化气", "LPG", "沥青", "甲醇", "PVC", "丙烯", "聚丙烯", "PP", "塑料", "PE", "PTA", "乙二醇", "MEG", "苯乙烯", "EB", "尿素", "烧碱", "对二甲苯", "PX", "纯苯", "短纤", "天然橡胶", "橡胶", "RU", "合成橡胶", "BR", "纸浆",
  // 农产品与油脂饲料
  "豆粕", "菜粕", "豆油", "棕榈油", "菜油", "菜籽", "大豆", "黄豆", "玉米", "淀粉", "白糖", "棉花", "棉纱", "红枣", "生猪", "苹果", "花生", "鸡蛋"
];

const BASE_URL = "https://www.fxbaogao.com";

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

async function main() {
  const targetDates = getTargetDates();
  console.log("多机构走列表抓取 - 目标日期:", targetDates);

  const matchedReports: { docId: number; title: string; orgName: string; pubDate: string }[] = [];
  let page = 1;
  let shouldStop = false;

  console.log("\n[🔍] 正在遍历 Category 20 列表寻找符合条件的研报...");

  while (!shouldStop && page <= 150) {
    console.log(`正在读取列表第 ${page} 页...`);
    try {
      const res = await fetch(`${BASE_URL}/category/20?page=${page}`);
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
        const pubDate = r.pubTimeStr; // 格式: "2026/07/01/"
        if (!pubDate) continue;

        // 如果发现报告日期比我们目标日期中最老的还要老，说明后面无需再翻页了
        const oldestTarget = targetDates[targetDates.length - 1];
        if (pubDate < oldestTarget) {
          shouldStop = true;
          break;
        }

        if (targetDates.includes(pubDate)) {
          const org = r.orgName || r.organName || "";
          const isBroker = org.includes("期货") || org === "国泰君安证券" || org === "南华研究";
          const isDaily = /日评|日报|晨报|早报|早评|周报|综合/i.test(r.title);

          if (isBroker && isDaily) {
            matchedReports.push({
              docId: r.docId,
              title: r.title,
              orgName: org,
              pubDate: pubDate
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

  console.log(`\n[✓] 列表检索完毕。共筛选出 ${matchedReports.length} 篇符合条件的期货日报/晨报。`);

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
    console.log(`正在汇总日期：${dateFormatted} (包含 ${orgNames.length} 家机构)`);
    console.log(`=========================================`);

    let finalMarkdown = `# 期货多机构研报与推演汇总 (${dateFormatted})\n\n`;
    finalMarkdown += `*   **汇总日期**：${dateFormatted}\n`;
    finalMarkdown += `*   **数据来源**：发现报告 (fxbaogao.com) Category 20 实时提取\n\n---* \n\n`;

    let totalPoints = 0;

    for (const orgName of orgNames) {
      console.log(`\n[🏛️] 正在解析 [${orgName}] 的研报...`);
      finalMarkdown += `## 🏛️ ${orgName}\n\n`;

      const reports = orgGroup[orgName];
      for (const report of reports) {
        console.log(`   -> 正在解析: [${report.docId}] ${report.title}`);
        
        try {
          const res = await fetch(`${BASE_URL}/detail/${report.docId}`);
          const html = await res.text();
          const bullets = extractBullets(html);
          
          if (bullets.length > 0) {
            const formattedSections = formatBulletsIntoSections(bullets);
            if (formattedSections.trim().length > 0) {
              finalMarkdown += `### 📌 ${report.title}\n\n`;
              finalMarkdown += formattedSections;
              finalMarkdown += `---\n\n`;
              totalPoints += bullets.length;
              console.log(`      [✓] 成功解析并归档 ${bullets.length} 条观点。`);
            }
          }
        } catch (e: any) {
          console.error(`      [x] 解析 [${report.docId}] 失败:`, e.message);
        }
        await sleep(350);
      }
    }

    if (totalPoints > 0) {
      const fileName = `期货多机构_${dateFormatted}_品种汇总.md`;
      const savePath = join(process.cwd(), fileName);
      await Bun.write(savePath, finalMarkdown);
      console.log(`\n[✓] 汇总文档成功，已保存至: ${savePath}`);
    }
  }

  console.log("\n多机构列表式研报汇总任务全部完成！");
}

main().catch(console.error);
