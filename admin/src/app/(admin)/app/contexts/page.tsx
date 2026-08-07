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
  keyword: string;
  dates: string[]; // 倒序（最新在前）
  files: ContextFile[];
};

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

  // 按品种分组，组内日期倒序，组间按最新日期倒序
  const { groups, others } = useMemo(() => {
    const list = Array.isArray(files) ? files : [];
    const map = new Map<string, KeywordGroup>();
    for (const file of list) {
      const parsed = parseContextName(file.name);
      if (!parsed) continue;
      let group = map.get(parsed.keyword);
      if (!group) {
        group = { keyword: parsed.keyword, dates: [], files: [] };
        map.set(parsed.keyword, group);
      }
      group.files.push(file);
    }
    const groupList = [...map.values()].map((g) => ({
      ...g,
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

  // 按品种生成：汇总该品种最近全部日期的投喂包
  const generateReport = async (keyword: string) => {
    setGenerating(keyword);
    try {
      const res = await apiRequest<{ fileName: string; content: string }>(["/ai/generate", "post"], { keyword });
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

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {groups.map((group) => {
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
                    onClick={() => generateReport(group.keyword)}
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
          })}
        </div>
        {groups.length === 0 && (
          <Typography.Text type="secondary">暂无品种投喂包，请先执行抓取任务</Typography.Text>
        )}

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
