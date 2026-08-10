export type TradeBias = "偏多" | "偏空" | "震荡观望";

export type PriceAnchor = {
  price: number;
  decimals: number;
  dailyChangePct: number | null;
  sourceLine: string;
};

type TradeLeg = {
  side: "做多" | "做空";
  entryLow: number;
  entryHigh: number;
  stop: number;
  target1: number;
  target2: number;
  rewardRisk1: number;
  rewardRisk2: number;
  trigger: string;
};

type Freshness = {
  executable: boolean;
  businessDaysOld: number;
  label: string;
};

export type VerifiedInstitutionPlan = {
  side: "做多" | "做空";
  entryLow: number;
  entryHigh: number;
  stop: number;
  target1: number;
  target2: number;
  decimals: number;
  sourceLine: string;
};

export type ValidatedTradePlanResult = {
  content: string;
  applied: boolean;
  executable: boolean;
  reason?: string;
  anchor?: PriceAnchor;
  bias?: TradeBias;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function cleanSourceLine(line: string): string {
  return line
    .replace(/^\s*[-*>]\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function parseQuotedNumber(raw: string): { value: number; decimals: number } | null {
  const normalized = raw.replace(/,/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const decimals = normalized.includes(".") ? normalized.split(".")[1]?.length ?? 0 : 0;
  return { value, decimals };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTargetTerm(line: string, term: string): boolean {
  const normalized = term.trim();
  if (!normalized) return false;
  if (/^[a-z0-9]+$/i.test(normalized)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, "i").test(line);
  }
  // 单个汉字别名（例如“锂”）误命中概率过高，不用于验证价格锚点。
  if (/^[\u3400-\u9fff]$/.test(normalized)) return false;
  return line.includes(normalized);
}

function targetTermsOf(keyword?: string, aliases: string[] = []): string[] {
  return [...new Set([keyword, ...aliases].filter((value): value is string => Boolean(value?.trim())))]
    .sort((a, b) => b.length - a.length);
}

function parseNumberWithDecimals(raw: string): { value: number; decimals: number } | null {
  return parseQuotedNumber(raw);
}

/**
 * 只接受同一条目标品种原文中同时存在方向、入场区间、止损和两个目标的完整机构方案。
 * “关注支撑/压力”等模糊点位不会被当作可执行方案。
 */
export function extractVerifiedInstitutionPlan(
  context: string,
  keyword?: string,
  aliases: string[] = [],
): VerifiedInstitutionPlan | null {
  const terms = targetTermsOf(keyword, aliases);
  if (terms.length === 0) return null;
  const lines = context.split(/\r?\n/)
    .map(cleanSourceLine)
    .flatMap((line) => line.split(/[；;。]/).map((segment) => segment.trim()).filter(Boolean));
  const entryPattern = /(?:挂单|入场|建仓|买入|卖出)(?:区间|价位|价格)?\D{0,12}([\d,]+(?:\.\d+)?)\s*(?:-|—|~|～|至)\s*([\d,]+(?:\.\d+)?)/;
  const stopPattern = /止损(?:位|价|位置)?\D{0,10}([\d,]+(?:\.\d+)?)/;
  const targetsPattern = /(?:止盈|目标(?:位|价)?)(?:区间)?\D{0,10}([\d,]+(?:\.\d+)?)\s*(?:\/|、|,|，|和|及|至|-|—|~|～)\s*([\d,]+(?:\.\d+)?)/;

  for (const line of lines) {
    if (!terms.some((term) => containsTargetTerm(line, term))) continue;
    const hasLongSignal = /做多|买入|低多|逢低多|回调多/.test(line);
    const hasShortSignal = /做空|卖出|高空|逢高空|反弹空/.test(line);
    if (hasLongSignal === hasShortSignal) continue;
    const side: VerifiedInstitutionPlan["side"] = hasLongSignal ? "做多" : "做空";

    const entryMatch = line.match(entryPattern);
    const stopMatch = line.match(stopPattern);
    const targetsMatch = line.match(targetsPattern);
    if (!entryMatch?.[1] || !entryMatch[2] || !stopMatch?.[1] || !targetsMatch?.[1] || !targetsMatch[2]) continue;
    const parsed = [entryMatch[1], entryMatch[2], stopMatch[1], targetsMatch[1], targetsMatch[2]]
      .map(parseNumberWithDecimals);
    if (parsed.some((value) => !value)) continue;
    const [entryA, entryB, stop, targetA, targetB] = parsed as [
      { value: number; decimals: number },
      { value: number; decimals: number },
      { value: number; decimals: number },
      { value: number; decimals: number },
      { value: number; decimals: number },
    ];
    const entryLow = Math.min(entryA.value, entryB.value);
    const entryHigh = Math.max(entryA.value, entryB.value);
    const targets = [targetA.value, targetB.value].sort((a, b) => a - b);
    const target1 = side === "做多" ? targets[0]! : targets[1]!;
    const target2 = side === "做多" ? targets[1]! : targets[0]!;
    const validDirection = side === "做多"
      ? stop.value < entryLow && entryLow <= entryHigh && entryHigh < target1 && target1 < target2
      : target2 < target1 && target1 < entryLow && entryLow <= entryHigh && entryHigh < stop.value;
    const averageEntry = (entryLow + entryHigh) / 2;
    const rr1 = rewardRisk(side, averageEntry, stop.value, target1);
    const rr2 = rewardRisk(side, averageEntry, stop.value, target2);
    if (!validDirection || rr1 < 1 || rr2 < 1.5) continue;

    return {
      side,
      entryLow,
      entryHigh,
      stop: stop.value,
      target1,
      target2,
      decimals: Math.max(...parsed.map((value) => value!.decimals)),
      sourceLine: line,
    };
  }
  return null;
}

/**
 * 从最新投喂包提取价格锚点。
 * 传入目标品种后，价格必须与目标品种出现在同一原文分句，防止多品种日报串价。
 */
export function extractLatestPriceAnchor(
  context: string,
  keyword?: string,
  aliases: string[] = [],
): PriceAnchor | null {
  const lines = context.split(/\r?\n/)
    .map(cleanSourceLine)
    .flatMap((line) => line.split(/[；;。]/).map((segment) => segment.trim()).filter(Boolean));
  const targetTerms = targetTermsOf(keyword, aliases);
  const targetLines = targetTerms.length > 0
    ? lines.filter((line) => targetTerms.some((term) => containsTargetTerm(line, term)))
    : lines;
  const mainLines = targetLines.filter((line) => /主力|活跃合约/.test(line));
  const candidates = mainLines.length > 0 ? mainLines : targetLines;
  const directPricePatterns = [
    /(?:最终收于|收盘价(?:为)?|收盘报|收于)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*元\s*\/\s*吨/i,
    /(?:最终收于|收盘价(?:为)?|收盘报|收于)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*点/i,
    /价格(?:为)?\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*元\s*\/\s*吨/i,
    /价格(?:为)?\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*点/i,
    /报\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*元\s*\/\s*吨/i,
    /报\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*点/i,
  ];
  const closeMovePatterns = [
    /(?:收涨|收跌)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*元\s*\/\s*吨/i,
    /(?:收涨|收跌)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*点/i,
  ];

  for (const line of candidates) {
    let match: RegExpMatchArray | null = null;
    for (const pattern of directPricePatterns) {
      match = line.match(pattern);
      if (match) break;
    }
    if (!match) {
      for (const pattern of closeMovePatterns) {
        const fallback = line.match(pattern);
        if (!fallback) continue;
        const percentIndex = line.search(/(?:涨跌幅|涨幅|跌幅)\s*[:：]?\s*[+-]?\d+(?:\.\d+)?\s*%/);
        // “收涨122元，涨幅3.62%”中的122是变动额，不是收盘价；百分比在前、收涨价在后时才接受。
        if (percentIndex >= 0 && fallback.index !== undefined && percentIndex > fallback.index) continue;
        match = fallback;
        break;
      }
    }
    const parsed = match?.[1] ? parseQuotedNumber(match[1]) : null;
    if (!parsed) continue;
    const changePatterns = [
      /(?:涨跌幅|涨幅|跌幅)\s*[:：]?\s*(?:约)?([+-]?\d+(?:\.\d+)?)\s*%/,
      /(?:日内)?收(?:涨|跌)\s*([+-]?\d+(?:\.\d+)?)\s*%/,
      /(?:较(?:前日|上一交易日|前一交易日))?(?:上涨|下跌)\s*([+-]?\d+(?:\.\d+)?)\s*%/,
    ];
    let changeMatch: RegExpMatchArray | null = null;
    for (const pattern of changePatterns) {
      changeMatch = line.match(pattern);
      if (changeMatch) break;
    }
    const dailyChangePct = changeMatch?.[1] ? Number(changeMatch[1]) : null;
    return {
      price: parsed.value,
      decimals: parsed.decimals,
      dailyChangePct: Number.isFinite(dailyChangePct) ? dailyChangePct : null,
      sourceLine: line,
    };
  }
  return null;
}

/** 只读取报告结论区的结构化字段，不扫描全文猜方向。 */
export function extractTradeBias(markdown: string): TradeBias {
  const plain = markdown.replace(/\*\*/g, "");
  const explicitBiases = [...plain.matchAll(/大方向判断\s*[：:]\s*(偏多|偏空|震荡观望)/g)]
    .map((match) => match[1] as TradeBias);
  const uniqueBiases = [...new Set(explicitBiases)];
  if (uniqueBiases.length === 1) return uniqueBiases[0]!;

  const strategy = plain.match(/主策略\s*[：:]\s*([^\n]+)/)?.[1] ?? "";
  if (/逢高空|反弹空/.test(strategy)) return "偏空";
  if (/回调多|逢低多/.test(strategy)) return "偏多";
  return "震荡观望";
}

function roundPrice(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function rewardRisk(side: TradeLeg["side"], entry: number, stop: number, target: number): number {
  const risk = side === "做多" ? entry - stop : stop - entry;
  const reward = side === "做多" ? target - entry : entry - target;
  if (risk <= 0 || reward <= 0) return 0;
  return reward / risk;
}

function buildLeg(side: TradeLeg["side"], anchor: PriceAnchor, v: number): TradeLeg {
  const p = anchor.price;
  const decimals = anchor.decimals;
  if (side === "做多") {
    const entryLow = roundPrice(p * (1 - 0.6 * v), decimals);
    const entryHigh = roundPrice(p * (1 - 0.3 * v), decimals);
    const stop = roundPrice(p * (1 - 1.2 * v), decimals);
    const target1 = roundPrice(p * (1 + 0.8 * v), decimals);
    const target2 = roundPrice(p * (1 + 1.6 * v), decimals);
    const entry = (entryLow + entryHigh) / 2;
    return {
      side,
      entryLow,
      entryHigh,
      stop,
      target1,
      target2,
      rewardRisk1: rewardRisk(side, entry, stop, target1),
      rewardRisk2: rewardRisk(side, entry, stop, target2),
      trigger: "价格回落进入区间后出现止跌确认再挂多；直接上冲不追单",
    };
  }

  const entryLow = roundPrice(p * (1 + 0.3 * v), decimals);
  const entryHigh = roundPrice(p * (1 + 0.6 * v), decimals);
  const stop = roundPrice(p * (1 + 1.2 * v), decimals);
  const target1 = roundPrice(p * (1 - 0.8 * v), decimals);
  const target2 = roundPrice(p * (1 - 1.6 * v), decimals);
  const entry = (entryLow + entryHigh) / 2;
  return {
    side,
    entryLow,
    entryHigh,
    stop,
    target1,
    target2,
    rewardRisk1: rewardRisk(side, entry, stop, target1),
    rewardRisk2: rewardRisk(side, entry, stop, target2),
    trigger: "价格反弹进入区间后出现滞涨确认再挂空；直接下跌不追单",
  };
}

function formatPrice(value: number, decimals: number): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function shanghaiDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function businessDaysBetween(fromDate: string, toDate: string): number | null {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  if (!from || !to) return null;
  if (from > to) return -1;
  let count = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export function evaluateFreshness(latestDate: string, now = new Date()): Freshness {
  const today = shanghaiDateString(now);
  const businessDaysOld = businessDaysBetween(latestDate, today);
  if (businessDaysOld === null) {
    return { executable: false, businessDaysOld: Number.POSITIVE_INFINITY, label: "日期格式无效，仅供观察" };
  }
  if (businessDaysOld < 0) {
    return { executable: false, businessDaysOld, label: `素材日期 ${latestDate} 晚于当前日期 ${today}，禁止直接执行` };
  }
  if (businessDaysOld === 0) {
    return { executable: true, businessDaysOld, label: `最近交易日数据（${latestDate}）；执行前仍需核对最新盘面` };
  }
  return {
    executable: false,
    businessDaysOld,
    label: `已滞后 ${businessDaysOld} 个交易日（素材 ${latestDate}，当前 ${today}），过期，仅供观察`,
  };
}

function buildPlanMarkdown(anchor: PriceAnchor, bias: TradeBias, latestDate: string, freshness: Freshness): string {
  const volatilityPct = clamp(Math.abs(anchor.dailyChangePct ?? 1.5), 1, 3);
  const v = volatilityPct / 100;
  const legs = bias === "偏多"
    ? [buildLeg("做多", anchor, v)]
    : bias === "偏空"
      ? [buildLeg("做空", anchor, v)]
      : [buildLeg("做多", anchor, v), buildLeg("做空", anchor, v)];

  const rows = legs.map((leg) => {
    const entry = `${formatPrice(leg.entryLow, anchor.decimals)}～${formatPrice(leg.entryHigh, anchor.decimals)}`;
    const rr = `${leg.rewardRisk1.toFixed(2)} / ${leg.rewardRisk2.toFixed(2)}`;
    const trigger = freshness.executable ? leg.trigger : `仅观察；刷新当日行情后重新计算。原触发逻辑：${leg.trigger}`;
    return `| ${leg.side} | ${entry} | ${formatPrice(leg.stop, anchor.decimals)} | ${formatPrice(leg.target1, anchor.decimals)} | ${formatPrice(leg.target2, anchor.decimals)} | ${rr} | ${trigger} |`;
  });

  const invalidation = legs.map((leg) => {
    if (leg.side === "做多") {
      return `做多方案在最新盘面已跌破 ${formatPrice(leg.stop, anchor.decimals)}，或未回调便直接突破第一止盈时失效，不追单。`;
    }
    return `做空方案在最新盘面已突破 ${formatPrice(leg.stop, anchor.decimals)}，或未反弹便直接跌破第一止盈时失效，不追单。`;
  }).join(" ");

  const executionLevel = freshness.executable
    ? "条件挂单参考；满足触发条件且复核当前主力合约最新价后方可执行"
    : "仅观察；必须先刷新投喂包并重新生成报告，禁止按旧点位直接挂单";
  const position = freshness.executable ? "轻仓；单笔实际亏损上限应由账户风险额度决定" : "仅观察";
  const staleWarning = freshness.executable
    ? ""
    : "\n\n> **数据已过期：以下点位只保留作复盘参考，不构成当前可执行挂单。请刷新数据后重新生成报告。**";

  return `### 挂单与风控（程序二次计算并校验）

- **AI 方向判断：** ${bias}
- **数据时效状态：** ${freshness.label}
- **价格锚点：** P=${formatPrice(anchor.price, anchor.decimals)}（${latestDate} 投喂包；${anchor.sourceLine}）
- **波动参数：** v=${volatilityPct.toFixed(2)}%（日涨跌幅绝对值限制在 1%～3%；缺失时使用 1.50%）
- **计划来源与置信度：** 程序波动公式；低。当前没有实时行情、盘口和统一结构化机构点位
- **执行级别：** ${executionLevel}
- **默认仓位：** ${position}
- **手数计算：** \`floor(单笔允许亏损金额 ÷（入场均价到止损的价差 × 合约乘数 + 预估手续费与滑点）)\`；因缺少账户与合约参数，系统不自动编手数

| 方向 | 挂单区间 | 硬止损 | 第一止盈 | 第二止盈 | 盈亏比 R1/R2 | 触发条件 |
|---|---:|---:|---:|---:|---:|---|
${rows.join("\n")}

- **计划失效条件：** ${invalidation}
- **风控动作：** 第一止盈可减仓，剩余仓位止损上移至成本附近；硬止损触发后不得补仓摊低成本。

> **AI 推演区间，非机构原文。该计划使用研报中的价格锚点而非实时行情；下单前必须确认当前主力合约、最新价格、最小变动价位和交易时段。**${staleWarning}`;
}

function buildInstitutionPlanMarkdown(
  plan: VerifiedInstitutionPlan,
  bias: TradeBias,
  latestDate: string,
  freshness: Freshness,
): string {
  const entry = (plan.entryLow + plan.entryHigh) / 2;
  const rr1 = rewardRisk(plan.side, entry, plan.stop, plan.target1);
  const rr2 = rewardRisk(plan.side, entry, plan.stop, plan.target2);
  const trigger = plan.side === "做多"
    ? "价格进入机构入场区间并出现止跌确认后执行；直接上冲不追单"
    : "价格进入机构入场区间并出现滞涨确认后执行；直接下跌不追单";
  const executionLevel = freshness.executable
    ? "机构完整方案已逐项核验；执行前仍须核对当前合约、最新价与交易时段"
    : "仅观察；机构方案已过期，刷新数据后再评估";
  const staleWarning = freshness.executable
    ? ""
    : "\n\n> **数据已过期：机构原文点位仅供复盘，禁止按旧方案直接挂单。**";

  return `### 挂单与风控（机构完整方案逐项核验）

- **AI 方向判断：** ${bias}
- **数据时效状态：** ${freshness.label}
- **计划来源与置信度：** 机构原文完整方案；高（方向、入场区间、止损、两个目标均在目标品种同一原文行中核验）
- **原文依据：** ${plan.sourceLine}
- **执行级别：** ${executionLevel}
- **默认仓位：** ${freshness.executable ? "轻仓；实际手数由账户风险额度、合约乘数、手续费和滑点决定" : "仅观察"}
- **手数计算：** \`floor(单笔允许亏损金额 ÷（入场均价到止损的价差 × 合约乘数 + 预估手续费与滑点）)\`；因缺少账户与合约参数，系统不自动编手数

| 方向 | 挂单区间 | 硬止损 | 第一止盈 | 第二止盈 | 盈亏比 R1/R2 | 触发条件 |
|---|---:|---:|---:|---:|---:|---|
| ${plan.side} | ${formatPrice(plan.entryLow, plan.decimals)}～${formatPrice(plan.entryHigh, plan.decimals)} | ${formatPrice(plan.stop, plan.decimals)} | ${formatPrice(plan.target1, plan.decimals)} | ${formatPrice(plan.target2, plan.decimals)} | ${rr1.toFixed(2)} / ${rr2.toFixed(2)} | ${freshness.executable ? trigger : `仅观察；原触发逻辑：${trigger}`} |

- **计划失效条件：** 当前盘面已越过硬止损，或未进入挂单区间便直接越过第一止盈时，原计划失效，不追单。
- **风控动作：** 第一止盈可减仓，剩余仓位止损上移至成本附近；硬止损触发后不得补仓摊低成本。

> **本表点位来自投喂包中的机构完整方案，但并非实时行情指令；下单前必须确认当前主力合约、最新价格、最小变动价位、手续费、滑点和交易时段。**${staleWarning}`;
}

function buildNoTradePlanMarkdown(latestDate: string, reason: string): string {
  const freshness = evaluateFreshness(latestDate);
  return `### 挂单与风控（程序二次校验：禁止挂单）

- **数据时效状态：** ${freshness.label}
- **执行结论：** 数据不足，暂不挂单
- **阻断原因：** ${reason}
- **需要补充：** 目标品种当日主力/活跃合约价格、涨跌幅、合约代码、最小变动价位及当前交易时段

> **服务端没有验证到目标品种自己的可靠价格锚点，因此已覆盖模型可能生成的点位，避免串用品种价格或让模型自由编价。**`;
}

function replaceTradePlan(markdown: string, plan: string): string {
  let content = markdown
    .replace(/^- \*\*价格锚点与波动参数：\*\*.*\r?\n?/m, "")
    .replace(/^- \*\*区间性质与置信度：\*\*.*\r?\n?/m, "");

  const existingPlan = /###\s+挂单与风控[^\n]*[\s\S]*?(?=\n##\s+1[.、])/;
  if (existingPlan.test(content)) return content.replace(existingPlan, plan);

  const sectionOne = content.search(/\n##\s+1[.、]/);
  content = sectionOne >= 0
    ? `${content.slice(0, sectionOne).trimEnd()}\n\n${plan}\n${content.slice(sectionOne)}`
    : `${content.trimEnd()}\n\n${plan}\n`;
  return content;
}

export function applyValidatedTradePlan(
  markdown: string,
  latestContext: string,
  latestDate: string,
  keyword?: string,
  aliases: string[] = [],
): ValidatedTradePlanResult {
  const bias = extractTradeBias(markdown);
  const freshness = evaluateFreshness(latestDate);
  const institutionPlan = extractVerifiedInstitutionPlan(latestContext, keyword, aliases);
  const institutionSideMatchesBias = institutionPlan
    && ((bias === "偏多" && institutionPlan.side === "做多") || (bias === "偏空" && institutionPlan.side === "做空"));
  if (institutionPlan && institutionSideMatchesBias) {
    return {
      content: replaceTradePlan(markdown, buildInstitutionPlanMarkdown(institutionPlan, bias, latestDate, freshness)),
      applied: true,
      executable: freshness.executable,
      bias,
      reason: freshness.executable ? undefined : freshness.label,
    };
  }

  const anchor = extractLatestPriceAnchor(latestContext, keyword, aliases);
  if (!anchor) {
    const directionConflict = institutionPlan && !institutionSideMatchesBias
      ? "机构完整方案方向与 AI 综合方向冲突，且未验证到目标品种最新价格锚点"
      : "最新投喂包未提取到与目标品种同一原文分句的主力/活跃合约价格锚点";
    return {
      content: replaceTradePlan(markdown, buildNoTradePlanMarkdown(latestDate, directionConflict)),
      applied: true,
      executable: false,
      reason: directionConflict,
      bias,
    };
  }

  const plan = buildPlanMarkdown(anchor, bias, latestDate, freshness);
  return {
    content: replaceTradePlan(markdown, plan),
    applied: true,
    executable: freshness.executable,
    anchor,
    bias,
    reason: freshness.executable ? undefined : freshness.label,
  };
}
