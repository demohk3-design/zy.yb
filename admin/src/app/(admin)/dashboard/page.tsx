import React from "react";
import { Card, Col, Row, Statistic, Table, Tag, Timeline, Typography } from "antd";
import {
  FileSearchOutlined,
  CheckCircleOutlined,
  BankOutlined,
  CalendarOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useRequest } from "@/hooks";
import { useGlobalStore } from "@/store";

type DashboardStats = {
  total: number;
  ok: number;
  todayCount: number;
  orgCount: number;
  latestDate: string | null;
  byDate: Record<string, number>;
  topKeywords: Array<{ keyword: string; count: number }>;
  latestRun: {
    id: number;
    status: string;
    phase: string;
    message: string | null;
    okCount: number;
    failCount: number;
    listTotal: number;
    keywordHits: number;
    searchDiff: number;
    createdAt: Date;
    finishedAt: Date | null;
  } | null;
  contextDir: string;
};

const statusMap: Record<string, { text: string; color: string }> = {
  running: { text: "运行中", color: "processing" },
  success: { text: "成功", color: "success" },
  failed: { text: "失败", color: "error" },
};

export default function DashboardPage() {
  const { dateRange } = useGlobalStore();
  const { data, loading } = useRequest<DashboardStats>("/dashboard/stats", {
    params: { startDate: dateRange?.[0], endDate: dateRange?.[1] },
    refreshDeps: [dateRange],
  });

  const byDateData = Object.entries(data.byDate || {})
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 14)
    .map(([date, count]) => ({ date, count }));

  const keywordData = (data.topKeywords || []).map((item, index) => ({
    key: item.keyword,
    rank: index + 1,
    ...item,
  }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title="报告总数"
              value={data.total ?? 0}
              prefix={<FileSearchOutlined />}
              loading={loading}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="抓取成功"
              value={data.ok ?? 0}
              prefix={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
              loading={loading}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="机构数量"
              value={data.orgCount ?? 0}
              prefix={<BankOutlined />}
              loading={loading}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="最新报告日期"
              value={data.latestDate || "-"}
              prefix={<CalendarOutlined />}
              loading={loading}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="近 14 天报告分布" loading={loading}>
            <Table
              size="small"
              rowKey="date"
              dataSource={byDateData}
              pagination={false}
              columns={[
                { title: "日期", dataIndex: "date" },
                { title: "数量", dataIndex: "count" },
              ]}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="关键词命中 Top 20（近 14 天）" loading={loading}>
            <Table
              size="small"
              rowKey="keyword"
              dataSource={keywordData}
              pagination={false}
              columns={[
                { title: "#", dataIndex: "rank", width: 50 },
                { title: "关键词", dataIndex: "keyword" },
                { title: "命中", dataIndex: "count" },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近抓取任务" loading={loading}>
        {data.latestRun ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <Typography.Text type="secondary">任务 #{data.latestRun.id} </Typography.Text>
              <Tag color={statusMap[data.latestRun.status]?.color}>
                {statusMap[data.latestRun.status]?.text || data.latestRun.status}
              </Tag>
              <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                {dayjs(data.latestRun.createdAt).format("YYYY-MM-DD HH:mm:ss")}
              </Typography.Text>
            </div>
            <div>{data.latestRun.message}</div>
            <Timeline
              items={[
                { children: `列表抓取：${data.latestRun.listTotal} 篇` },
                { children: `详情下载：成功 ${data.latestRun.okCount} / 失败 ${data.latestRun.failCount}` },
                { children: `关键词命中：${data.latestRun.keywordHits} 次` },
                { children: `search_list 对账差异：${data.latestRun.searchDiff} 篇` },
              ]}
            />
          </div>
        ) : (
          <Typography.Text type="secondary">暂无抓取任务</Typography.Text>
        )}
      </Card>
    </div>
  );
}
