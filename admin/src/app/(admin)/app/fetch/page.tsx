import React, { useEffect, useRef, useState } from "react";
import { Button, Card, Tag, Typography, Progress, Table, Space, Alert, Statistic, Row, Col } from "antd";
import { ThunderboltOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { apiRequest, useRequest } from "@/hooks";

type FetchRun = {
  id: number;
  phase: string;
  status: string;
  message: string | null;
  targetDates: string[];
  listTotal: number;
  detailTotal: number;
  okCount: number;
  failCount: number;
  keywordHits: number;
  searchDiff: number;
  createdAt: Date;
  finishedAt: Date | null;
};

const phaseMap: Record<string, string> = {
  list: "列表抓取",
  detail: "详情下载",
  done: "生成投喂包",
  failed: "失败",
};
const statusMap: Record<string, { text: string; color: string }> = {
  running: { text: "运行中", color: "processing" },
  success: { text: "成功", color: "success" },
  failed: { text: "失败", color: "error" },
};

export default function FetchPage() {
  const [starting, setStarting] = useState(false);
  const [activeRun, setActiveRun] = useState<FetchRun | null>(null);
  const [polling, setPolling] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 历史任务（最新 20 条）
  const { data: history, loading: historyLoading, refresh: refreshHistory } =
    useRequest<FetchRun[]>("/fetch/runs", { params: { pageSize: 20, current: 1 } });

  const stopPolling = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
  };

  const fetchRunDetail = async (runId: number) => {
    try {
      const res = await apiRequest<FetchRun>([`/fetch/runs/${runId}`, "get"]);
      const data = res.data;
      setActiveRun(data ?? null);
      if (data?.status !== "running") {
        stopPolling();
        refreshHistory();
      }
    } catch {
      stopPolling();
    }
  };

  const startPolling = (runId: number) => {
    stopPolling();
    setPolling(true);
    fetchRunDetail(runId);
    timerRef.current = window.setInterval(() => {
      fetchRunDetail(runId);
    }, 1500);
  };

  // 页面加载：若最新任务仍在运行，恢复轮询
  useEffect(() => {
    apiRequest<FetchRun[]>(["/fetch/runs", "get"], { pageSize: 1, current: 1 })
      .then((res) => {
        const latest = Array.isArray(res.data) ? res.data[0] : undefined;
        if (latest && latest.status === "running") {
          startPolling(latest.id);
        }
      })
      .catch(() => {});
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRun = async () => {
    setStarting(true);
    try {
      const res = await apiRequest<{ runId: number }>(["/fetch/run", "post"]);
      if (res.data?.runId) {
        startPolling(res.data.runId);
      }
      refreshHistory();
    } catch {
      // interceptor shows error
    } finally {
      setStarting(false);
    }
  };

  const total = activeRun ? activeRun.listTotal : 0;
  const done = activeRun ? activeRun.okCount + activeRun.failCount : 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const historyData = (Array.isArray(history) ? history : []).map((r) => ({ ...r, key: r.id }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              抓取期货机构研报（今天 + 昨天）
            </Typography.Title>
            <Typography.Text type="secondary">
              流程：分类列表抓取 → search_list 对账 → 详情下载 → 关键词命中 → 生成 AI 投喂包
            </Typography.Text>
          </div>
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={starting || polling}
              onClick={startRun}
            >
              开始抓取
            </Button>
          </Space>
        </div>
      </Card>

      {activeRun && activeRun.status === "running" && (
        <Card title={`当前任务 #${activeRun.id}（实时进度）`}>
          <div style={{ display: "grid", gap: 16 }}>
            <Alert
              type="info"
              showIcon
              message={`阶段：${phaseMap[activeRun.phase] || activeRun.phase} — ${activeRun.message}`}
            />
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="列表命中" value={activeRun.listTotal} />
              </Col>
              <Col span={6}>
                <Statistic title="成功" value={activeRun.okCount} valueStyle={{ color: "#3f8600" }} />
              </Col>
              <Col span={6}>
                <Statistic title="失败" value={activeRun.failCount} valueStyle={{ color: "#cf1322" }} />
              </Col>
              <Col span={6}>
                <Statistic title="关键词命中" value={activeRun.keywordHits} />
              </Col>
            </Row>
            <Progress percent={percent} status={activeRun.phase === "detail" ? "active" : undefined} />
          </div>
        </Card>
      )}

      {activeRun && activeRun.status !== "running" && (
        <Card title={`任务 #${activeRun.id} 结果`}>
          <Space direction="vertical" size={8}>
            <div>
              <Tag color={statusMap[activeRun.status]?.color}>
                {statusMap[activeRun.status]?.text}
              </Tag>
              <Typography.Text>{activeRun.message}</Typography.Text>
            </div>
            <Typography.Text type="secondary">
              开始 {dayjs(activeRun.createdAt).format("YYYY-MM-DD HH:mm:ss")}
              {activeRun.finishedAt
                ? ` ｜ 结束 ${dayjs(activeRun.finishedAt).format("YYYY-MM-DD HH:mm:ss")}`
                : ""}
              {" ｜ 目标日期 "}
              {(activeRun.targetDates || []).join(", ")}
            </Typography.Text>
            <div>
              <Button size="small" icon={<ReloadOutlined />} onClick={refreshHistory}>
                刷新历史
              </Button>
            </div>
          </Space>
        </Card>
      )}

      <Card title="历史任务">
        <Table
          size="small"
          rowKey="id"
          loading={historyLoading}
          dataSource={historyData}
          pagination={false}
          columns={[
            { title: "任务", dataIndex: "id", width: 70 },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (_: unknown, r: FetchRun) => (
                <Tag color={statusMap[r.status]?.color}>{statusMap[r.status]?.text || r.status}</Tag>
              ),
            },
            { title: "阶段", dataIndex: "phase", width: 100, render: (v: string) => phaseMap[v] || v },
            { title: "列表", dataIndex: "listTotal", width: 70 },
            { title: "成功", dataIndex: "okCount", width: 70 },
            { title: "失败", dataIndex: "failCount", width: 70 },
            { title: "关键词命中", dataIndex: "keywordHits", width: 100 },
            { title: "对账差异", dataIndex: "searchDiff", width: 90 },
            {
              title: "开始时间",
              dataIndex: "createdAt",
              width: 170,
              render: (v: Date) => dayjs(v).format("MM-DD HH:mm:ss"),
            },
            {
              title: "说明",
              dataIndex: "message",
              ellipsis: true,
              render: (v: string) => v || "-",
            },
          ]}
        />
      </Card>
    </div>
  );
}
