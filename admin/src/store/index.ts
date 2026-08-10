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

// 默认时间范围：最近五天
const defaultDateRange = (): [string, string] => {
  const today = dayjs().format("YYYY-MM-DD");
  const fiveDaysAgo = dayjs().subtract(4, "day").format("YYYY-MM-DD");
  return [fiveDaysAgo, today];
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
    const defaultRange = defaultDateRange();
    const savedRange = persistedSnapshot.dateRange;
    const isOldDefault =
      savedRange && dayjs(savedRange[1]).diff(dayjs(savedRange[0]), "day") <= 1;

    Object.assign(store, persistedSnapshot, {
      refreshTable: currentSnapshot.refreshTable ?? persistedSnapshot.refreshTable ?? false,
      dateRange: isOldDefault ? defaultRange : savedRange ?? defaultRange,
    });
    subscribe(store, () => {
      Object.assign(persisted, snapshot(store));
    });
  });
}
