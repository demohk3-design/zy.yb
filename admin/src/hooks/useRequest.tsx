import axios, { AxiosHeaders } from "axios";
import type {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { useRequest as useAhooksRequest } from "ahooks";
import { message } from "antd";

const baseURL = process.env.NEXT_PUBLIC_API_BASE || "/admin";

type ResponseData<T = unknown> = {
  code?: number;
  message?: string;
  data?: T;
  total?: number;
};

type RequestConfig = {
  params?: Record<string, unknown>;
  refreshDeps?: unknown[];
  manual?: boolean;
  ready?: boolean;
};

type ApiProxy = Record<
  string,
  (
    dataOrParams: Record<string, unknown> | FormData | undefined,
    method: string,
    baseUr?: string,
  ) => Promise<ResponseData<any>>
>;

const service = axios.create({
  timeout: 120000,
  baseURL,
  withCredentials: true,
});

service.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const headers = AxiosHeaders.from(config.headers);
    config.headers = headers;
    return config;
  },
  () => Promise.reject("Request error"),
);

const errorMsg = (msg: string) => message.error(msg);

service.interceptors.response.use(
  (response: AxiosResponse<ResponseData>) => {
    const code = response.data?.code;
    const msg = response.data?.message || "Request failed";
    if (typeof code === "number" && code !== 0) {
      errorMsg(msg);
      return Promise.reject(new Error(msg));
    }
    return response;
  },
  (error) => {
    const msg = error.response?.data?.message || "Unknown error";
    errorMsg(msg);
    return Promise.reject(error);
  },
);

const apiProxy = new Proxy({} as ApiProxy, {
  get(target, url: string) {
    return (
      dataOrParams: Record<string, unknown> | FormData | undefined,
      method = "get",
      baseUr?: string,
    ) => {
      const config: AxiosRequestConfig = {
        method,
        url,
        baseURL: baseUr || baseURL,
      };
      if (method.toLowerCase() === "get") {
        config.params = dataOrParams && !(dataOrParams instanceof FormData) ? dataOrParams : undefined;
      } else {
        config.data = dataOrParams;
      }
      return service(config).then((res) => res.data);
    };
  },
});

export const useRequest = <T = any,>(apiName: string | string[], config: RequestConfig = {}) => {
  const { params = {}, ...restConfig } = config || {};
  const [name, apiMethod, apiBaseUrl] = Array.isArray(apiName)
    ? apiName
    : [apiName, "get", ""];
  const requestConfig = {
    ...restConfig,
    throttleWait: 100,
  };

  const {
    data: res,
    error,
    loading,
    ...rest
  } = useAhooksRequest((runParams: Record<string, unknown> = {}) => {
    return apiProxy[name](
      {
        ...params,
        ...runParams,
      },
      apiMethod,
      apiBaseUrl,
    );
  }, requestConfig);

  const list = (res?.data as T[]) || [];
  const data = (res?.data as T) || ({} as T);

  return {
    ...rest,
    data,
    list,
    error,
    loading,
    res: res as ResponseData<T>,
  };
};

export const apiRequest = <T = any,>(
  apiName: string | string[],
  params: any = {},
): Promise<ResponseData<T>> => {
  const [name, defaultMethod, apiBaseUrl] = Array.isArray(apiName)
    ? apiName
    : [apiName, "get", ""];

  let apiMethod = defaultMethod;
  let restParams = params;
  if (!(params instanceof FormData)) {
    const { method, ...rest } = params || {};
    if (method) apiMethod = method;
    restParams = rest;
  }

  return apiProxy[name](restParams, apiMethod, apiBaseUrl) as Promise<ResponseData<T>>;
};
