import { describe, expect, test } from "bun:test";
import {
  applyValidatedTradePlan,
  evaluateFreshness,
  extractLatestPriceAnchor,
  extractSwingRange,
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
    expect(result.content).toContain("### 周/月级别建仓与风控");
    expect(result.content).toContain("| 做空 | 4,570～4,696 | 4,786 | 4,462 | 4,318 | 1.12 / 2.06 |");
    expect(result.content).toContain("分批建仓");
    expect(result.content).toContain("计划持有约 2～12 周");
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

  test("周/月计划允许最近五个交易日内执行，但更旧素材仅供观察", () => {
    const recent = evaluateFreshness("2026-08-07", new Date("2026-08-10T04:00:00Z"));
    expect(recent.executable).toBeTrue();
    expect(recent.businessDaysOld).toBe(1);
    expect(recent.label).toContain("周/月级别素材");

    const stale = evaluateFreshness("2026-08-01", new Date("2026-08-10T04:00:00Z"));
    expect(stale.executable).toBeFalse();
    expect(stale.businessDaysOld).toBe(6);
    expect(stale.label).toContain("超过周/月计划执行窗口");
  });


  test("优先提取目标品种的机构中期运行区间", () => {
    const context = "* PVC基本面偏弱，反弹空配。V【4400-4600】；TA【5680-5850】。";
    const range = extractSwingRange(context, "PVC");
    expect(range?.low).toBe(4400);
    expect(range?.high).toBe(4600);
    expect(range?.side).toBe("偏空");
  });

  test("方向只从结论字段或主策略读取，不被正文多空词污染", () => {
    expect(extractTradeBias("- **大方向判断：** 偏多。\n正文同时讨论偏空风险")).toBe("偏多");
    expect(extractTradeBias("正文包含看多与看空观点，没有结论字段")).toBe("震荡观望");
  });
});
