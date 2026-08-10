export type TradeBias = "偏多" | "偏空" | "震荡观望";

export type PriceAnchor = {
  price: number;
  decimals: number;
  dailyChangePct: number | null;
  sourceLine: string;
};

export type SwingRange = {
  low: number;
  high: number;
  decimals: number;
  side: TradeBias;
  sourceLine: string;
  explicit: boolean;
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
    if (/日内|隔夜|超短线|短线交易/.test(line)) continue;
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

/**
 * 提取适合周/月级别交易的机构运行区间或支撑压力区间。
 * 只接受包含目标品种和“区间/策略/支撑/压力”等语义的原文，避免把日期或其他品种数字当成交易区间。
 */
export function extractSwingRange(
  context: string,
  keyword?: string,
  aliases: string[] = [],
): SwingRange | null {
  const terms = targetTermsOf(keyword, aliases);
  const lines = context.split(/\r?\n/).map(cleanSourceLine).filter(Boolean);
  const rangePattern = /([\d,]+(?:\.\d+)?)\s*(万)?\s*(?:-|—|~|～|至|到)\s*([\d,]+(?:\.\d+)?)\s*(万)?/g;

  for (const line of lines) {
    if (terms.length > 0 && !terms.some((term) => containsTargetTerm(line, term))) continue;
    if (!/(区间|支撑|压力|策略|单边|高抛低吸|反弹空|逢高空|做空|回调多|逢低多|做多|空配|多配|运行)/.test(line)) continue;

    for (const match of line.matchAll(rangePattern)) {
      const matchEnd = (match.index ?? 0) + (match[0]?.length ?? 0);
      const suffix = line.slice(matchEnd, matchEnd + 4);
      // 排除“8-9月”“2026-2030年”等时间范围，它们不是价格区间。
      if (/^\s*(?:年|月|日|个月|交易日)/.test(suffix)) continue;
      const first = parseQuotedNumber(match[1] ?? "");
      const second = parseQuotedNumber(match[3] ?? "");
      if (!first || !second) continue;
      const commonUnit = match[4] === "万" || match[2] === "万" ? 10_000 : 1;
      const low = Math.min(first.value, second.value) * commonUnit;
      const high = Math.max(first.value, second.value) * commonUnit;
      if (!(high > low) || high / low > 2.5) continue;

      const hasLong = /做多|回调多|逢低多|低多|偏多|多配|看多/.test(line);
      const hasShort = /做空|反弹空|逢高空|高空|偏空|空配|看空/.test(line);
      const side: TradeBias = hasLong === hasShort
        ? "震荡观望"
        : hasLong ? "偏多" : "偏空";
      return {
        low,
        high,
        decimals: Math.max(first.decimals, second.decimals),
        side,
        sourceLine: line,
        explicit: true,
      };
    }
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

function buildSwingLeg(range: SwingRange, side: TradeLeg["side"]): TradeLeg & { rangeLow: number; rangeHigh: number } {
  const low = range.low;
  const high = range.high;
  const width = high - low;
  const decimals = range.decimals;

  if (side === "做多") {
    const entryLow = roundPrice(low + width * 0.08, decimals);
    const entryHigh = roundPrice(low + width * 0.36, decimals);
    const stop = roundPrice(low - width * 0.12, decimals);
    const target1 = roundPrice(low + width * 0.60, decimals);
    const target2 = roundPrice(low + width * 0.92, decimals);
    const entry = (entryLow + entryHigh) / 2;
    return {
      side, entryLow, entryHigh, stop, target1, target2,
      rewardRisk1: rewardRisk(side, entry, stop, target1),
      rewardRisk2: rewardRisk(side, entry, stop, target2),
      trigger: "周/月逻辑未破坏，价格回落至分批建仓带并出现周线止跌或日线反转确认；未回调到位不追多",
      rangeLow: low,
      rangeHigh: high,
    };
  }

  const entryLow = roundPrice(high - width * 0.36, decimals);
  const entryHigh = roundPrice(high - width * 0.08, decimals);
  const stop = roundPrice(high + width * 0.12, decimals);
  const target1 = roundPrice(low + width * 0.40, decimals);
  const target2 = roundPrice(low + width * 0.08, decimals);
  const entry = (entryLow + entryHigh) / 2;
  return {
    side, entryLow, entryHigh, stop, target1, target2,
    rewardRisk1: rewardRisk(side, entry, stop, target1),
    rewardRisk2: rewardRisk(side, entry, stop, target2),
    trigger: "周/月逻辑未破坏，价格反弹至分批建仓带并出现周线滞涨或日线反转确认；未反弹到位不追空",
    rangeLow: low,
    rangeHigh: high,
  };
}

function buildProxyRange(anchor: PriceAnchor): SwingRange {
  // 没有周/月 OHLC 或 ATR 时，只能用最近日变动的 20 个交易日平方根放大作为低置信度代理。
  // 这不是实时波动率，必须在报告中明确标注，并要求下单前人工复核。
  const dailyPct = Math.abs(anchor.dailyChangePct ?? 1.25);
  const swingPct = clamp(dailyPct * Math.sqrt(20), 5, 15) / 100;
  return {
    low: roundPrice(anchor.price * (1 - swingPct), anchor.decimals),
    high: roundPrice(anchor.price * (1 + swingPct), anchor.decimals),
    decimals: anchor.decimals,
    side: "震荡观望",
    sourceLine: `以价格锚点 ${formatPrice(anchor.price, anchor.decimals)} 和最近日变动 ${dailyPct.toFixed(2)}% 推算约一个月波动代理（${(swingPct * 100).toFixed(2)}%）`,
    explicit: false,
  };
}

function stagedEntryText(leg: TradeLeg & { rangeLow: number; rangeHigh: number }, side: TradeLeg["side"]): string {
  const width = leg.rangeHigh - leg.rangeLow;
  const precision = Math.max(0, String(leg.entryLow).split(".")[1]?.length ?? 0);
  if (side === "做多") {
    const a = roundPrice(leg.rangeLow + width * 0.28, precision);
    const b = roundPrice(leg.rangeLow + width * 0.36, precision);
    const c = roundPrice(leg.rangeLow + width * 0.16, precision);
    const e = roundPrice(leg.rangeLow + width * 0.28, precision);
    const f = roundPrice(leg.rangeLow + width * 0.08, precision);
    const g = roundPrice(leg.rangeLow + width * 0.16, precision);
    return `首仓30%：${formatPrice(a, precision)}～${formatPrice(b, precision)}；二仓40%：${formatPrice(c, precision)}～${formatPrice(e, precision)}；三仓30%：${formatPrice(f, precision)}～${formatPrice(g, precision)}`;
  }
  const a = roundPrice(leg.rangeHigh - width * 0.36, precision);
  const b = roundPrice(leg.rangeHigh - width * 0.24, precision);
  const c = roundPrice(leg.rangeHigh - width * 0.24, precision);
  const e = roundPrice(leg.rangeHigh - width * 0.12, precision);
  const f = roundPrice(leg.rangeHigh - width * 0.12, precision);
  const g = roundPrice(leg.rangeHigh - width * 0.08, precision);
  return `首仓30%：${formatPrice(a, precision)}～${formatPrice(b, precision)}；二仓40%：${formatPrice(c, precision)}～${formatPrice(e, precision)}；三仓30%：${formatPrice(f, precision)}～${formatPrice(g, precision)}`;
}

function buildPlanMarkdown(anchor: PriceAnchor, bias: TradeBias, latestDate: string, freshness: Freshness, explicitRange: SwingRange | null): string {
  const range = explicitRange ?? buildProxyRange(anchor);
  const effectiveBias = bias === "偏多" || bias === "偏空" ? bias : range.side;
  const legs = effectiveBias === "偏多"
    ? [buildSwingLeg(range, "做多")]
    : effectiveBias === "偏空"
      ? [buildSwingLeg(range, "做空")]
      : [buildSwingLeg(range, "做多"), buildSwingLeg(range, "做空")];
  const sourceLabel = range.explicit ? "机构原文运行/支撑压力区间；中" : "中期波动代理；低";
  const staleWarning = freshness.executable
    ? ""
    : "\n\n> **素材已超过执行窗口：以下区间仅供复盘，刷新近期数据并重新生成后再评估。**";
  const rows = legs.map((leg) => {
    const trigger = freshness.executable ? leg.trigger : `仅观察；${leg.trigger}`;
    return `| ${leg.side} | ${formatPrice(leg.entryLow, anchor.decimals)}～${formatPrice(leg.entryHigh, anchor.decimals)} | ${formatPrice(leg.stop, anchor.decimals)} | ${formatPrice(leg.target1, anchor.decimals)} | ${formatPrice(leg.target2, anchor.decimals)} | ${leg.rewardRisk1.toFixed(2)} / ${leg.rewardRisk2.toFixed(2)} | ${trigger} |`;
  });
  const staged = legs.map((leg) => `- **${leg.side}分批建仓：** ${stagedEntryText(leg, leg.side)}。总建仓带：${formatPrice(leg.entryLow, anchor.decimals)}～${formatPrice(leg.entryHigh, anchor.decimals)}。`).join("\n");
  const invalidation = legs.map((leg) => leg.side === "做多"
    ? `做多在 ${formatPrice(leg.stop, anchor.decimals)} 下方硬止损；若周线收盘跌破关键成本/基本面支撑，月线多头逻辑失效。`
    : `做空在 ${formatPrice(leg.stop, anchor.decimals)} 上方硬止损；若周线收盘突破关键压力/基本面转强，月线空头逻辑失效。`).join(" ");
  const position = freshness.executable ? "分三批建仓，首仓不超过计划仓位30%；单笔总风险建议控制在账户权益0.5%～1%以内" : "仅观察";
  const executionLevel = freshness.executable
    ? "周/月级别条件计划；先等价格进入建仓带，再按周线逻辑确认执行，不因单日波动追单"
    : "仅观察；刷新数据后重新计算，禁止按旧区间直接挂单";
  const proxyNote = range.explicit
    ? `- **中期参考区间：** ${formatPrice(range.low, anchor.decimals)}～${formatPrice(range.high, anchor.decimals)}（${range.sourceLine}）`
    : `- **中期参考区间：** ${formatPrice(range.low, anchor.decimals)}～${formatPrice(range.high, anchor.decimals)}（${range.sourceLine}；仅为低置信度代理，不等同于机构点位）`;

  return `### 周/月级别建仓与风控（程序二次计算并校验）

- **AI 方向判断：** ${bias}
- **交易周期：** 周线开仓，计划持有约 2～12 周；月线基本面逻辑未破坏前，不因单日波动随意平仓
- **数据时效状态：** ${freshness.label}
- **价格锚点：** P=${formatPrice(anchor.price, anchor.decimals)}（${latestDate} 投喂包；${anchor.sourceLine}）
${proxyNote}
- **计划来源与置信度：** ${sourceLabel}
- **执行级别：** ${executionLevel}
- **仓位纪律：** ${position}
- **手数计算：** \`floor(单笔允许亏损金额 ÷（入场均价到硬止损的价差 × 合约乘数 + 预估手续费与滑点）)\`；缺少账户、合约乘数和费用时不编造具体手数

| 方向 | 总建仓区间 | 硬止损 | 第一止盈 | 第二止盈 | 盈亏比 R1/R2 | 周/月级别触发条件 |
|---|---:|---:|---:|---:|---:|---|
${rows.join("\n")}

${staged}
- **计划失效条件：** ${invalidation}
- **止盈与持仓管理：** 第一止盈兑现后减仓30%～50%，剩余仓位止损上移至成本；第二止盈附近观察周线结构，若趋势延续再用前一周高/低点移动止损。
- **禁止事项：** 硬止损后不得补仓摊低；价格未进入建仓带不得追单；没有实时行情时不得把本表当成自动下单指令。

> **${range.explicit ? "区间来自投喂包中的机构/关键价位信息，但最终建仓、止损和止盈为程序按周/月级别规则推演，非实时行情指令。" : "AI 中期推演区间，非机构原文；由于素材没有周/月 OHLC 或 ATR，置信度低。"} 下单前必须确认当前主力合约、最新价格、最小变动价位、手续费、滑点和交易时段。**${staleWarning}`;
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
  if (businessDaysOld <= 5) {
    return { executable: true, businessDaysOld, label: `近 ${businessDaysOld} 个交易日内的周/月级别素材（${latestDate}）；执行前必须核对最新盘面` };
  }
  return {
    executable: false,
    businessDaysOld,
    label: `已滞后 ${businessDaysOld} 个交易日（素材 ${latestDate}，当前 ${today}），超过周/月计划执行窗口，仅供观察`,
  };
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
    ? "价格进入机构入场区间并出现周线止跌确认后分批执行；直接上冲不追单"
    : "价格进入机构入场区间并出现周线滞涨确认后分批执行；直接下跌不追单";
  const executionLevel = freshness.executable
    ? "机构完整方案已逐项核验；执行前仍须核对当前合约、最新价与交易时段"
    : "仅观察；机构方案已过期，刷新数据后再评估";
  const staleWarning = freshness.executable
    ? ""
    : "\n\n> **数据已过期：机构原文点位仅供复盘，禁止按旧方案直接挂单。**";

  return `### 周/月级别建仓与风控（机构完整方案逐项核验）

- **AI 方向判断：** ${bias}
- **数据时效状态：** ${freshness.label}
- **计划来源与置信度：** 机构原文完整方案；高（方向、入场区间、止损、两个目标均在目标品种同一原文行中核验）
- **原文依据：** ${plan.sourceLine}
- **执行级别：** ${executionLevel}
- **仓位纪律：** ${freshness.executable ? "分三批建仓，首仓不超过计划仓位30%；实际手数由账户风险额度、合约乘数、手续费和滑点决定" : "仅观察"}
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
  return `### 周/月级别建仓与风控（程序二次校验：禁止挂单）

- **数据时效状态：** ${freshness.label}
- **执行结论：** 数据不足，暂不挂单
- **阻断原因：** ${reason}
- **需要补充：** 目标品种近期主力/活跃合约价格、周/月运行区间或 OHLC/ATR、合约代码、最小变动价位及当前交易时段

> **服务端没有验证到目标品种自己的可靠价格锚点，因此已覆盖模型可能生成的点位，避免串用品种价格或让模型自由编价。**`;
}

function replaceTradePlan(markdown: string, plan: string): string {
  let content = markdown
    .replace(/^- \*\*价格锚点与波动参数：\*\*.*\r?\n?/m, "")
    .replace(/^- \*\*区间性质与置信度：\*\*.*\r?\n?/m, "");

  const existingPlan = /###\s+(?:挂单与风控|周\/月级别建仓与风控)[^\n]*[\s\S]*?(?=\n##\s+1[.、])/;
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

  const swingRange = extractSwingRange(latestContext, keyword, aliases);
  const plan = buildPlanMarkdown(anchor, bias, latestDate, freshness, swingRange);
  return {
    content: replaceTradePlan(markdown, plan),
    applied: true,
    executable: freshness.executable,
    anchor,
    bias,
    reason: freshness.executable ? undefined : freshness.label,
  };
}
