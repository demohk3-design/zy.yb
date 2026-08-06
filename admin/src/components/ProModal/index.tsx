import React, { useRef, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { BetaSchemaForm } from "@ant-design/pro-components";
import { message, type FormInstance } from "antd";
import { apiRequest } from "@/hooks";
import { useReactive } from "ahooks";
import { globalStore } from "@/store";

interface ActionRefType {
  open: (mode?: "add" | "edit" | "view", item?: any) => void;
  add?: (apiGet: any, params: any, mode?: "add" | "edit" | "view") => void;
  edit?: (apiEdit: any, params: any) => void;
  view?: (apiGet: any, params: any) => void;
  delete?: (delApi: any, params: any) => void;
  close: () => void;
}

interface ProModalProps {
  trigger: React.ReactNode;
  title: string;
  columns: any[] | ((item: any) => any[]);
  apiPath?: string;
  addFormData?: (values: any, item: any) => any;
  initFormData?: (data: any) => any;
  layoutType?: "ModalForm" | "DrawerForm";
  onSuccess?: (result: any) => void;
  onError?: (error: any) => void;
  actionRef?: React.MutableRefObject<ActionRefType | null>;
  width?: string;
  noMode?: boolean;
  layout?: "vertical" | "horizontal" | "inline";
  wrapperCol?: { span: number };
  labelCol?: { span: number };
  className?: string;
  [key: string]: any;
}

const ProModal: React.FC<ProModalProps> = ({
  trigger,
  title,
  columns,
  apiPath,
  addFormData,
  initFormData,
  layoutType = "ModalForm",
  onSuccess,
  onError,
  actionRef,
  width,
  noMode,
  layout,
  wrapperCol = { span: 18 },
  labelCol = { span: 4 },
  className,
  ...xProps
}) => {
  const formRef = useRef<FormInstance>(null);
  const location = useLocation();
  const resolvedApiPath = apiPath || location.pathname || "";
  const state = useReactive<{
    open: boolean;
    item: any;
    initialValues: any;
  }>({
    open: false,
    item: null,
    initialValues: {},
  });

  useEffect(() => {
    if (state.open && formRef.current) {
      formRef.current.resetFields();
      formRef.current.setFieldsValue(state.initialValues);
    }
  }, [state.open, state.initialValues]);

  if (actionRef) {
    actionRef.current = {
      ...formRef.current,
      open: (mode, item) => {
        globalStore.mode = mode || "add";
        if (item) {
          const values = initFormData ? initFormData(item) : { ...item };
          state.item = item;
          state.initialValues = values;
        } else {
          state.item = null;
          state.initialValues = {};
        }
        state.open = true;
      },
      close: () => {
        state.open = false;
      },
    };
  }

  const [loading, setLoading] = useState(false);

  const handleFinish = async (values: any) => {
    try {
      if (globalStore.mode === "view") {
        message.info("查看模式下不允许提交");
        return false;
      }
      await formRef.current?.validateFields();
      const transformedData = addFormData ? addFormData(values, state.item) : values;
      setLoading(true);
      const mode = globalStore.mode || "add";
      const id = state.item?.id;
      const apiPath = mode === "add" ? `${resolvedApiPath}/add` : `${resolvedApiPath}/edit/${id}`;
      const { code, message: msg } = await apiRequest(
        [apiPath, mode === "add" ? "post" : "put"],
        { ...transformedData, id },
      );
      if (code === 0) {
        message.success(msg || "操作成功");
        if (onSuccess) {
          onSuccess({ code, message: msg });
        }
        state.open = false;
        globalStore.refreshTable = true;
        return true;
      }
      message.error(msg || "操作失败");
    } catch (error) {
      console.error("表单提交失败:", error);
      if (onError) onError(error);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const getColumns = () => {
    const cols = typeof columns === "function" ? columns(state.item) : columns;
    if (globalStore.mode !== "view") return cols;
    return (Array.isArray(cols) ? cols : []).map((column: any) => ({
      ...column,
      disabled: true,
      fieldProps: { ...column.fieldProps, disabled: true, showSearch: false },
    }));
  };

  const getTitle = () => {
    if (noMode) return title;
    const obj = { view: "查看", edit: "编辑", add: "新增" };
    return [title, obj[globalStore.mode || "add"]].filter(Boolean).join(" - ");
  };

  return (
    <div>
      {trigger ? (
        <div
          onClick={() => {
            globalStore.mode = "add";
            state.open = true;
          }}
        >
          {trigger}
        </div>
      ) : null}
      {state.open && (
        <BetaSchemaForm
          width={width}
          formRef={formRef as any}
          title={getTitle()}
          columns={getColumns()}
          layoutType={layoutType}
          layout={layout}
          labelAlign="right"
          labelCol={labelCol}
          wrapperCol={wrapperCol}
          className={className}
          initialValues={state.initialValues}
          submitter={
            globalStore.mode === "view"
              ? false
              : {
                  searchConfig: { submitText: "确定", resetText: "取消" },
                  submitButtonProps: { loading },
                }
          }
          onFinish={handleFinish}
          open={state.open}
          onOpenChange={(open: boolean) => {
            state.open = open;
          }}
          {...xProps}
        />
      )}
    </div>
  );
};

export default ProModal;
