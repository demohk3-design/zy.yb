import React, { useRef } from "react";
import { Button, Tag, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ProTable, ProModal } from "@/components";

type Keyword = {
  id: number;
  keyword: string;
  category: string;
  enabled: boolean;
  sort: number;
  createdAt: string;
};

export default function KeywordsPage() {
  const actionRef = useRef<any>(null);
  const modalActionRef = useRef<any>(null);

  return (
    <div>
      <ProTable
        apiName="keywords"
        actionRef={actionRef}
        rowKey="id"
        columns={[
          { title: "ID", dataIndex: "id", key: "id", width: 70, search: false },
          {
            title: "关键词",
            dataIndex: "keyword",
            key: "keyword",
            copyable: true,
          },
          {
            title: "类别",
            dataIndex: "category",
            key: "category",
            valueType: "select",
            valueEnum: {
              "黑色建材与铁合金": { text: "黑色建材与铁合金" },
              有色与新能源: { text: "有色与新能源" },
              能源化工: { text: "能源化工" },
              农产品与油脂饲料: { text: "农产品与油脂饲料" },
              其他: { text: "其他" },
            },
          },
          {
            title: "启用",
            dataIndex: "enabled",
            key: "enabled",
            valueType: "select",
            valueEnum: {
              true: { text: "启用", status: "Success" },
              false: { text: "停用", status: "Default" },
            },
            render: (_: unknown, record: Keyword) =>
              record.enabled ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
          },
          { title: "排序", dataIndex: "sort", key: "sort", search: false },
          {
            title: "操作",
            key: "actions",
            valueType: "option",
            render: (_: unknown, record: Keyword) => [
              <Button
                key="edit"
                type="link"
                size="small"
                onClick={() => modalActionRef.current?.open("edit", record)}
              >
                编辑
              </Button>,
              <Button
                key="delete"
                type="link"
                size="small"
                danger
                onClick={() => actionRef.current?.delete?.("/keywords", { id: record.id })}
              >
                删除
              </Button>,
            ],
          },
        ]}
        toolBarRender={() => [
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => modalActionRef.current?.open("add")}
          >
            新增关键词
          </Button>,
        ]}
        params={{}}
      />

      <ProModal
        actionRef={modalActionRef}
        title="关键词"
        trigger={<></>}
        apiPath="keywords"
        columns={[
          {
            title: "关键词",
            dataIndex: "keyword",
            formItemProps: { rules: [{ required: true, message: "请输入关键词" }] },
          },
          {
            title: "类别",
            dataIndex: "category",
            valueType: "select",
            valueEnum: {
              "黑色建材与铁合金": { text: "黑色建材与铁合金" },
              有色与新能源: { text: "有色与新能源" },
              能源化工: { text: "能源化工" },
              农产品与油脂饲料: { text: "农产品与油脂饲料" },
              其他: { text: "其他" },
            },
            initialValue: "其他",
          },
          {
            title: "启用",
            dataIndex: "enabled",
            valueType: "switch",
            initialValue: true,
          },
          {
            title: "排序",
            dataIndex: "sort",
            valueType: "digit",
            initialValue: 0,
          },
        ]}
        onSuccess={() => {
          actionRef.current?.reload?.();
        }}
      />
    </div>
  );
}
