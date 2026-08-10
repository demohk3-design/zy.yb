import React, { useMemo, useState } from "react";
import {
  Card, Table, Tag, Typography, Drawer, Button, Space, Select, message, Alert, Tooltip,
} from "antd";
import { ReloadOutlined, CopyOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { apiRequest, useRequest } from "@/hooks";

type ContextFile = {
  name: string;
  size: number;
  mtime: Date;
  kind: "context" | "detail";
};

type ReportFile = {
  name: string;
  size: number;
  mtime: Date;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

// 解析关键词投喂包文件名 => { keyword, date }；common 通用包或非投喂包返回 null
const parseContextName = (name: string): { keyword: string; date: string } | null => {
  const match = name.match(/^fx_ai_context_(.+?)_(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match || match[1] === "common") return null;
  return { keyword: match[1], date: match[2] };
};

type KeywordGroup = {
  keyword: string; // 标准品种名
  aliases: string[]; // 该品种全部原始关键词（含标准名，用于生成报告匹配）
  dates: string[]; // 倒序（最新在前）
  files: ContextFile[];
};

// 品种分类（固定输出，位置稳定便于查找）
// 核心 33 个品种及顺序严格对齐 agent.md L24-28；其余为抓取中实际出现的品种/别名
const CATEGORY_LIST: { name: string; color: string; varieties: { name: string; aliases: string[] }[] }[] = [
  {
    name: "黑色建材与铁合金",
    color: "volcano",
    varieties: [
      { name: "螺纹钢", aliases: ["螺纹"] },
      { name: "热轧卷板", aliases: ["热卷", "热轧"] },
      { name: "焦煤", aliases: [] },
      { name: "焦炭", aliases: [] },
      { name: "锰硅", aliases: [] },
      { name: "硅铁", aliases: [] },
      { name: "玻璃", aliases: [] },
      { name: "纯碱", aliases: [] },
      { name: "铁矿石", aliases: ["铁矿"] },
      { name: "不锈钢", aliases: [] },
      { name: "双焦", aliases: [] },
    ],
  },
  {
    name: "有色与新能源",
    color: "gold",
    varieties: [
      { name: "氧化铝", aliases: [] },
      { name: "工业硅", aliases: [] },
      { name: "碳酸锂", aliases: ["锂"] },
      { name: "多晶硅", aliases: [] },
    ],
  },
  {
    name: "能源化工",
    color: "blue",
    varieties: [
      { name: "燃料油", aliases: [] },
      { name: "液化石油气", aliases: ["液化气", "LPG"] },
      { name: "沥青", aliases: [] },
      { name: "甲醇", aliases: [] },
      { name: "聚乙烯", aliases: ["塑料", "PE"] },
      { name: "聚丙烯", aliases: ["丙烯", "PP"] },
      { name: "PVC", aliases: [] },
      { name: "PTA", aliases: [] },
      { name: "对二甲苯", aliases: ["PX"] },
      { name: "乙二醇", aliases: ["MEG", "EG"] },
      { name: "苯乙烯", aliases: ["EB"] },
      { name: "尿素", aliases: [] },
      { name: "烧碱", aliases: [] },
      { name: "短纤", aliases: [] },
      { name: "纸浆", aliases: [] },
      { name: "纯苯", aliases: [] },
      { name: "原油", aliases: [] },
      { name: "天然橡胶", aliases: ["橡胶", "RU"] },
      { name: "丁二烯橡胶", aliases: ["合成橡胶", "BR"] },
    ],
  },
  {
    name: "农产品与油脂饲料",
    color: "green",
    varieties: [
      { name: "豆粕", aliases: [] },
      { name: "菜粕", aliases: [] },
      { name: "豆油", aliases: [] },
      { name: "棕榈油", aliases: [] },
      { name: "菜籽油", aliases: ["菜油"] },
      { name: "一号黄大豆", aliases: ["大豆"] },
      { name: "白糖", aliases: [] },
      { name: "红枣", aliases: [] },
      { name: "苹果", aliases: [] },
      { name: "花生", aliases: [] },
      { name: "鸡蛋", aliases: [] },
      { name: "生猪", aliases: [] },
      { name: "玉米", aliases: [] },
      { name: "棉花", aliases: [] },
      { name: "棉纱", aliases: [] },
      { name: "淀粉", aliases: [] },
      { name: "菜籽", aliases: [] },
    ],
  },
];

// 原始关键词 → 标准品种名的映射（别名归并）
const ALIAS_MAP = new Map<string, string>();
for (const cat of CATEGORY_LIST) {
  for (const v of cat.varieties) {
    ALIAS_MAP.set(v.name, v.name);
    for (const a of v.aliases) ALIAS_MAP.set(a, v.name);
  }
}

export default function ContextsPage() {
  const { data: files, loading, refresh } = useRequest<ContextFile[]>("/contexts/read");
  const [content, setContent] = useState<{ name: string; content: string } | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [rebuildDate, setRebuildDate] = useState<string>();
  const [rebuilding, setRebuilding] = useState(false);

  const { data: dates } = useRequest<string[]>("/reports/dates");

  // AI 研报生成
  const [generating, setGenerating] = useState<string>();
  const [report, setReport] = useState<{ name: string; content: string } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const { data: reportFiles, loading: reportLoading, refresh: refreshReports } = useRequest<ReportFile[]>("/ai/files");

  // 按标准品种归并分组（别名归一到标准名），组内日期倒序
  const { groups, others } = useMemo(() => {
    const list = Array.isArray(files) ? files : [];
    const map = new Map<string, KeywordGroup>();
    for (const file of list) {
      const parsed = parseContextName(file.name);
      if (!parsed) continue;
      const standard = ALIAS_MAP.get(parsed.keyword) ?? parsed.keyword;
      let group = map.get(standard);
      if (!group) {
        group = { keyword: standard, aliases: [], dates: [], files: [] };
        map.set(standard, group);
      }
      if (!group.aliases.includes(parsed.keyword)) group.aliases.push(parsed.keyword);
      group.files.push(file);
    }
    const groupList = [...map.values()].map((g) => ({
      ...g,
      aliases: g.aliases.length > 0 ? g.aliases : [g.keyword],
      dates: g.files
        .map((f) => parseContextName(f.name)?.date ?? "")
        .sort((a, b) => b.localeCompare(a)),
    }));
    groupList.sort((a, b) => b.dates[0].localeCompare(a.dates[0]));
    return {
      groups: groupList,
      others: list.filter((f) => !parseContextName(f.name) && /^(fx_ai_context_|fx_report_details_|download_fx_text_)/.test(f.name)),
    };
  }, [files]);

  const openContent = async (name: string) => {
    setViewLoading(true);
    setViewOpen(true);
    setContent(null);
    try {
      const res = await apiRequest<{ name: string; content: string }>(["/contexts/content", "get"], {
        file: name,
      });
      setContent(res.data ?? null);
    } catch {
      // interceptor shows error
    } finally {
      setViewLoading(false);
    }
  };

  // 按品种生成：汇总该品种最近全部日期的投喂包（aliases 为全部原始关键词，兼容别名文件）
  const generateReport = async (keyword: string, aliases: string[]) => {
    setGenerating(keyword);
    try {
      const res = await apiRequest<{ fileName: string; content: string }>(["/ai/generate", "post"], {
        keyword,
        aliases,
      });
      message.success(`已生成 ${res.data?.fileName}`);
      refreshReports();
      // 生成成功后新窗口直接打开 HTML 报告
      const fileName = res.data?.fileName;
      if (fileName) {
        window.open(`/reports/${fileName}`, "_blank", "noopener,noreferrer");
      }
    } catch {
      // interceptor shows error
    } finally {
      setGenerating(undefined);
    }
  };

  const rebuild = async () => {
    if (!rebuildDate) {
      message.warning("请选择要重建的日期");
      return;
    }
    setRebuilding(true);
    try {
      const res = await apiRequest<{ files: string[] }>(["/contexts/rebuild", "post"], {
        dateFormatted: rebuildDate,
      });
      message.success(`已重建 ${res.data?.files.length ?? 0} 个投喂包文件`);
      refresh();
    } catch {
      // interceptor shows error
    } finally {
      setRebuilding(false);
    }
  };

  const otherSource = others.map((f) => ({ ...f, key: f.name }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title="投喂包 / 原料文件">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
          <Space>
            <Typography.Text type="secondary">
              共 {files?.length ?? 0} 个文件，目录：context/
            </Typography.Text>
          </Space>
          <Space>
            <Select
              placeholder="选择日期重建投喂包"
              style={{ width: 200 }}
              value={rebuildDate}
              onChange={setRebuildDate}
              options={(Array.isArray(dates) ? dates : []).map((d) => ({ label: d, value: d }))}
              showSearch
            />
            <Button
              icon={<ReloadOutlined />}
              loading={rebuilding}
              onClick={rebuild}
            >
              从数据库重建
            </Button>
            <Button onClick={refresh}>刷新</Button>
          </Space>
        </div>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="按品种分组展示，组内日期倒序；「生成报告」会自动汇总该品种最近全部日期的数据一起交给 AI 分析（按需调用，省 token）。仅保留最近 5 天数据，过期自动清理。"
        />

        {(() => {
          const groupMap = new Map(groups.map((g) => [g.keyword, g]));
          // 不在固定分类清单内的品种归入「其他品种」
          const knownNames = new Set(CATEGORY_LIST.flatMap((c) => c.varieties.map((v) => v.name)));
          const unknownGroups = groups
            .filter((g) => !knownNames.has(g.keyword))
            .sort((a, b) => b.dates[0].localeCompare(a.dates[0]));

          const renderGroupCard = (group: KeywordGroup) => {
            const latestDate = group.dates[0];
            const rows = group.files
              .map((f) => ({ ...f, key: f.name, date: parseContextName(f.name)?.date ?? "" }))
              .sort((a, b) => b.date.localeCompare(a.date));
            return (
              <Card
                key={group.keyword}
                size="small"
                title={
                  <Space size={6}>
                    <span>{group.keyword}</span>
                    <Tag color="blue">近 {group.dates.length} 日</Tag>
                  </Space>
                }
                extra={
                  <Button
                    type="primary"
                    size="small"
                    loading={generating === group.keyword}
                    disabled={generating !== undefined}
                    onClick={() => generateReport(group.keyword, group.aliases)}
                  >
                    生成报告
                  </Button>
                }
              >
                <Space wrap size={[6, 6]}>
                  {rows.map((r) => (
                    <Tooltip key={r.key} title={`大小 ${formatSize(r.size)}`}>
                      <Tag
                        color={r.date === latestDate ? "green" : "blue"}
                        style={{ cursor: "pointer", marginInlineEnd: 0 }}
                        onClick={() => openContent(r.name)}
                      >
                        {r.date}
                        {r.date === latestDate && " 最新"}
                      </Tag>
                    </Tooltip>
                  ))}
                </Space>
              </Card>
            );
          };

          return (
            <>
              {CATEGORY_LIST.map((cat) => (
                <div key={cat.name} style={{ marginBottom: 20 }}>
                  <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <Tag color={cat.color} style={{ marginInlineEnd: 0, fontWeight: 600 }}>
                      {cat.name}
                    </Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {cat.varieties.length} 个品种
                    </Typography.Text>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {cat.varieties.map((v) => {
                      const group = groupMap.get(v.name);
                      if (!group) {
                        // 固定占位：无数据品种保留位置，便于查找
                        return (
                          <Card
                            key={v.name}
                            size="small"
                            title={<span style={{ color: "#bfbfbf" }}>{v.name}</span>}
                            styles={{ body: { padding: "10px 12px" } }}
                          >
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              暂无数据
                            </Typography.Text>
                          </Card>
                        );
                      }
                      return renderGroupCard(group);
                    })}
                  </div>
                </div>
              ))}

              {unknownGroups.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <Tag style={{ marginInlineEnd: 0, fontWeight: 600 }}>其他品种</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {unknownGroups.length} 个品种（不在核心监控池）
                    </Typography.Text>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {unknownGroups.map((g) => renderGroupCard(g))}
                  </div>
                </div>
              )}

              {groups.length === 0 && (
                <Typography.Text type="secondary">暂无品种投喂包，请先执行抓取任务</Typography.Text>
              )}
            </>
          );
        })()}

        {otherSource.length > 0 && (
          <Card title="其他文件（通用投喂包 / 原料 JSON）" size="small" style={{ marginTop: 12 }}>
            <Table
              size="small"
              rowKey="name"
              dataSource={otherSource}
              pagination={false}
              columns={[
                {
                  title: "文件名",
                  dataIndex: "name",
                  render: (v: string) => (
                    <Button type="link" style={{ padding: 0 }} onClick={() => openContent(v)}>
                      {v}
                    </Button>
                  ),
                },
                {
                  title: "类型",
                  dataIndex: "kind",
                  width: 110,
                  render: (v: string) =>
                    v === "context" ? (
                      <Tag color="blue">AI 投喂包</Tag>
                    ) : (
                      <Tag>原料 JSON</Tag>
                    ),
                },
              ]}
            />
          </Card>
        )}
      </Card>

      <Card
        title="已生成研报"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={refreshReports}>
            刷新
          </Button>
        }
      >
        <Table
          size="small"
          rowKey="name"
          loading={reportLoading}
          dataSource={(Array.isArray(reportFiles) ? reportFiles : []).map((f) => ({ ...f, key: f.name }))}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 份研报` }}
          locale={{ emptyText: "还没有生成过研报，在品种卡片中点击「生成报告」即可" }}
          columns={[
            {
              title: "文件名",
              dataIndex: "name",
              render: (v: string) => {
                const htmlName = v.replace(/\.md$/, ".html");
                return (
                  <a href={`/reports/${htmlName}`} target="_blank" rel="noreferrer" title="新窗口打开">
                    {htmlName}
                  </a>
                );
              },
            },
            {
              title: "数据日期",
              dataIndex: "name",
              width: 120,
              render: (v: string) => {
                const m = v.match(/_(\d{4}-\d{2}-\d{2})\.(?:md|html)$/);
                return m ? m[1] : "-";
              },
            },
            {
              title: "生成时间",
              dataIndex: "mtime",
              width: 170,
              render: (v: Date) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
            },
          ]}
        />
      </Card>

      <Drawer
        title={content?.name || "文件内容"}
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        width={760}
        loading={viewLoading}
      >
        {content ? (
          <div
            className="report-markdown"
            style={{
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              padding: 16,
            }}
          >
            {content.content}
          </div>
        ) : (
          <Typography.Text type="secondary">加载中...</Typography.Text>
        )}
      </Drawer>

      <Drawer
        title={report?.name || "AI 研报"}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        width={860}
        extra={
          report ? (
            <Button
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard?.writeText(report.content).then(() => message.success("已复制到剪贴板"));
              }}
            >
              复制全文
            </Button>
          ) : undefined
        }
      >
        {report ? (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.7,
              maxHeight: "70vh",
              overflow: "auto",
            }}
          >
            {report.content}
          </pre>
        ) : (
          <Typography.Text type="secondary">加载中...</Typography.Text>
        )}
      </Drawer>
    </div>
  );
}
