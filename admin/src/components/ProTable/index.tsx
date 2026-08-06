import type { ActionType, ProColumns } from "@ant-design/pro-components";
import { ProTable as AntdProTable } from "@ant-design/pro-components";
import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { apiRequest } from "@/hooks";
import { message } from "antd";
import { globalStore, useGlobalStore } from "@/store";

type ProTableWrapperProps = {
  apiName?: string | string[];
  columns?: ProColumns[];
  toolBarRender?: () => React.ReactNode[];
  dataSource?: any[];
  actionRef?: React.MutableRefObject<any>;
  path?: string;
  className?: string;
  rowKey?: string;
  [key: string]: any;
};

export default function ProTableWrapper({
  apiName = undefined,
  columns = [] as any,
  toolBarRender = () => [],
  dataSource = undefined,
  actionRef = undefined,
  path = undefined,
  className = "",
  rowKey = "id",
  ...xProps
}: ProTableWrapperProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const hasExplicitApiNameArray = Array.isArray(apiName);
  const resolvedApiName =
    typeof apiName === "string" && apiName.trim()
      ? [apiName.trim()]
      : hasExplicitApiNameArray
        ? apiName
        : pathname
          ? [pathname]
          : [];
  if (!resolvedApiName.length && !xProps.request && !dataSource) {
    return <></>;
  }

  const tableRef = useRef<ActionType | null>(null);
  const formRef = useRef<any>(null);
  const globalSnapshot = useGlobalStore();

  const normalizedColumns = useMemo(
    () =>
      (columns as ProColumns[]).map((column) => {
        if (column.valueType !== "option") {
          return column;
        }
        const optionWidth =
          typeof column.width === "number"
            ? Math.max(column.width, 160)
            : (column.width ?? 160);
        const optionClassName = [column.className, "app-pro-table-option-column"]
          .filter(Boolean)
          .join(" ");
        return {
          ...column,
          className: optionClassName,
          width: optionWidth,
          onHeaderCell: (col: any) => {
            const extraProps =
              typeof column.onHeaderCell === "function" ? column.onHeaderCell(col) : {};
            return {
              ...extraProps,
              className: [extraProps?.className, "app-pro-table-option-column"]
                .filter(Boolean)
                .join(" "),
              style: {
                whiteSpace: "nowrap",
                minWidth: 160,
                ...(extraProps?.style || {}),
              },
            };
          },
          onCell: (record: any, index?: number) => {
            const extraProps =
              typeof column.onCell === "function" ? column.onCell(record, index) : {};
            return {
              ...extraProps,
              className: [extraProps?.className, "app-pro-table-option-column"]
                .filter(Boolean)
                .join(" "),
              style: {
                whiteSpace: "nowrap",
                minWidth: 160,
                ...(extraProps?.style || {}),
              },
            };
          },
        };
      }),
    [columns],
  );

  const mergedClassName = ["app-pro-table", className].filter(Boolean).join(" ");

  if (actionRef) {
    actionRef.current = {
      ...tableRef.current,
      delete(delApi: string, params: any) {
        const id = params?.id;
        const apiPath = id ? `${delApi}/delete/${id}` : `${delApi}/delete`;
        apiRequest([apiPath, "delete"], params || {}).then(({ message: msg, code }) => {
          if (code === 0) {
            message.success(msg || "删除成功");
            actionRef.current?.reload();
          } else {
            message.error(msg || "操作失败");
          }
        });
      },
      runApi(apiName: string | string[], params: any, callback?: (data: any) => void) {
        apiRequest(apiName, params).then(({ message: msg, code, data }) => {
          if (code === 0) {
            if (callback) {
              return callback?.(data);
            }
            message.success(msg || "操作成功");
            actionRef.current?.reload();
          } else {
            message.error(msg || "操作失败");
          }
        });
      },
    };
  }

  useEffect(() => {
    if (globalSnapshot.refreshTable) {
      if (tableRef?.current?.reload) {
        tableRef.current.reload();
        setTimeout(() => {
          globalStore.refreshTable = false;
        }, 20);
      }
    }
  }, [globalSnapshot.refreshTable]);

  return (
    <AntdProTable
      columns={normalizedColumns}
      className={mergedClassName}
      dataSource={dataSource}
      formRef={formRef}
      actionRef={(ref) => {
        tableRef.current = ref ?? null;
        if (actionRef && ref) {
          actionRef.current = { ...actionRef.current, ...ref };
        }
      }}
      cardBordered
      request={
        dataSource === undefined
          ? async (params: any) => {
              if (!resolvedApiName.length) {
                return { data: [], success: true, total: 0 };
              }
              const { pageSize, current, ...xpar } = params;
              const res = await apiRequest<any[]>([`${resolvedApiName}/read`, "get"], {
                ...xpar,
                ...(xProps.params || {}),
                current,
                pageSize,
              });
              const list = Array.isArray(res.data) ? res.data : [];
              const total =
                typeof (res as any).total === "number" ? (res as any).total : list.length;
              return {
                data: list,
                success: res.code === 0,
                total,
              };
            }
          : undefined
      }
      rowKey={rowKey}
      search={{
        labelWidth: "auto",
      }}
      pagination={{
        defaultPageSize: 20,
        showQuickJumper: true,
        showTotal: (total) => `共 ${total} 条`,
      }}
      dateFormatter="string"
      toolBarRender={toolBarRender}
      {...xProps}
    />
  );
}
