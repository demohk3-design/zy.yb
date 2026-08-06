import { proxy, snapshot, subscribe } from "valtio";
import { useSnapshot } from "valtio/react";
import { persist } from "valtio-persist";
import dayjs from "dayjs";

interface GlobalState {
  refreshTable: boolean;
  mode: "add" | "edit" | "view";
  dateRange: [string, string];
  [key: string]: unknown;
}

const STORAGE_KEY = "fx_admin_global_state";

// 默认时间范围：昨天 + 今天
const defaultDateRange = (): [string, string] => {
  const today = dayjs().format("YYYY-MM-DD");
  const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
  return [yesterday, today];
};

const initialState: GlobalState = {
  refreshTable: false,
  mode: "add",
  dateRange: defaultDateRange(),
};

export const store = proxy<GlobalState>(initialState);
export const globalStore = store;

export const setGlobalStore = (data: Partial<GlobalState>) => {
  Object.assign(store, data);
};

export const useGlobalStore = () => {
  const snap = useSnapshot(store);
  return { ...snap, setGlobalStore };
};

if (typeof window !== "undefined") {
  persist(initialState, STORAGE_KEY).then(async ({ store: persisted, restore }) => {
    await restore();
    const persistedSnapshot = snapshot(persisted) as GlobalState;
    const currentSnapshot = snapshot(store) as GlobalState;
    Object.assign(store, persistedSnapshot, {
      refreshTable: currentSnapshot.refreshTable ?? persistedSnapshot.refreshTable ?? false,
    });
    subscribe(store, () => {
      Object.assign(persisted, snapshot(store));
    });
  });
}
