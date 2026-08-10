import { describe, expect, test } from "bun:test";
import {
  applyValidatedTradePlan,
  evaluateFreshness,
  extractLatestPriceAnchor,
  extractTradeBias,
  extractVerifiedInstitutionPlan,
} from "./trade-plan";

const report = (bias = "偏空") => `# PVC期货研报

## 0. 交易结论先行

- **大方向判断：** ${bias}。测试
- **主策略：** 逢高空

### 挂单与风控

| 项目 | 价格/条件 | 依据 |
|---|---:|---|
| 做空挂单区间 | 无 | 模型漏填 |

## 1. 核心观点

测试正文`;

describe("trade plan validation", () => {
  test("只提取目标品种同一行的价格，避免多品种串价", () => {
    const context = `
* 甲醇主力合约涨跌幅1.2%，收涨2,502元/吨。
* PVC主力合约变动17元/吨，涨跌幅0.38%，收跌4,507元/吨。
`;
    expect(extractLatestPriceAnchor(context, "PVC")?.price).toBe(4507);
    expect(extractLatestPriceAnchor(context, "乙二醇")).toBeNull();
  });


  test("优先提取报价值，不把收涨金额误当成价格", () => {
    const context = "* 高硫燃料油收涨122.00元/吨，涨幅3.62%，报3491.00元/吨。";
    const anchor = extractLatestPriceAnchor(context, "燃料油");
    expect(anchor?.price).toBe(3491);
    expect(anchor?.dailyChangePct).toBe(3.62);
  });


  test("同句同时有开盘和收盘时优先采用最终收盘价", () => {
    const context = "* 玉米C2609合约开盘报2240元/吨，最低至2235元/吨，最终收于2245元/吨，涨幅约0.22%。";
    const anchor = extractLatestPriceAnchor(context, "玉米");
    expect(anchor?.price).toBe(2245);
    expect(anchor?.dailyChangePct).toBe(0.22);
  });

  test("按明确方向覆盖模型交易表并生成完整空头计划", () => {
    const context = "* PVC主力合约变动17元/吨，涨跌幅0.38%，收跌4,507元/吨。";
    const result = applyValidatedTradePlan(report(), context, "2026-08-10", "PVC");
    expect(result.applied).toBeTrue();
    expect(result.executable).toBeTrue();
    expect(result.bias).toBe("偏空");
    expect(result.content).toContain("| 做空 | 4,521～4,534 | 4,561 | 4,471 | 4,435 | 1.69 / 2.76 |");
    expect(result.content).not.toContain("模型漏填");
  });


  test("机构完整方案只有逐项同句核验后才优先采用", () => {
    const context = "* PVC建议逢高做空，挂单区间4,520-4,540，止损4,570，止盈4,480/4,440。";
    const verified = extractVerifiedInstitutionPlan(context, "PVC");
    expect(verified?.side).toBe("做空");
    expect(verified?.entryLow).toBe(4520);
    const result = applyValidatedTradePlan(report(), context, "2026-08-10", "PVC");
    expect(result.executable).toBeTrue();
    expect(result.content).toContain("机构完整方案逐项核验");
    expect(result.content).toContain("| 做空 | 4,520～4,540 | 4,570 | 4,480 | 4,440 |");
  });


  test("机构完整方案盈亏比不合格时不作为高置信度方案", () => {
    const context = "* PVC建议逢高做空，挂单区间4,520-4,540，止损4,570，止盈4,510/4,500。";
    expect(extractVerifiedInstitutionPlan(context, "PVC")).toBeNull();
  });

  test("目标价格缺失时覆盖模型点位并禁止挂单", () => {
    const context = "* 甲醇主力合约涨跌幅1.2%，收涨2,502元/吨。";
    const result = applyValidatedTradePlan(report(), context, "2026-08-10", "PVC");
    expect(result.executable).toBeFalse();
    expect(result.content).toContain("程序二次校验：禁止挂单");
    expect(result.content).toContain("避免串用品种价格");
    expect(result.content).not.toContain("模型漏填");
  });

  test("旧交易日数据只允许观察", () => {
    const freshness = evaluateFreshness("2026-08-07", new Date("2026-08-10T04:00:00Z"));
    expect(freshness.executable).toBeFalse();
    expect(freshness.businessDaysOld).toBe(1);
    expect(freshness.label).toContain("过期，仅供观察");
  });

  test("方向只从结论字段或主策略读取，不被正文多空词污染", () => {
    expect(extractTradeBias("- **大方向判断：** 偏多。\n正文同时讨论偏空风险")).toBe("偏多");
    expect(extractTradeBias("正文包含看多与看空观点，没有结论字段")).toBe("震荡观望");
  });
});
