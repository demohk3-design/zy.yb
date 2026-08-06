import React, { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { PageContainer, ProConfigProvider, ProLayout } from "@ant-design/pro-components";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import { MENU_CONFIG, findFirstMenuPath } from "@/constants/menus";
import { useGlobalStore, setGlobalStore } from "@/store";

function AdminShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const pathname = location.pathname;
  const { dateRange } = useGlobalStore();

  const firstAccessiblePath = useMemo(() => findFirstMenuPath(MENU_CONFIG), []);
  const resolvedPathname = pathname === "/" ? firstAccessiblePath : pathname || firstAccessiblePath;

  const breadcrumbItems = useMemo(() => {
    const findChain = (routes: any[], target: string, chain: any[]): any[] | null => {
      for (const route of routes) {
        const nextChain = [...chain, route];
        if (route.path === target) return nextChain;
        if (Array.isArray(route.routes) && route.routes.length > 0) {
          const found = findChain(route.routes, target, nextChain);
          if (found) return found;
        }
      }
      return null;
    };
    const chain = findChain(MENU_CONFIG, resolvedPathname, []) || [];
    return chain.map((route) => ({ title: route.name }));
  }, [resolvedPathname]);

  return (
    <ProConfigProvider>
      <div style={{ height: "100vh" }}>
        <ProLayout
          layout="mix"
          siderWidth={220}
          title={false}
          logo={false}
          location={{ pathname: resolvedPathname }}
          route={{ routes: MENU_CONFIG as any }}
          menuItemRender={(item, dom) => (
            <Link to={item.path || "/"} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              {dom}
            </Link>
          )}
          headerContentRender={() => (
            <DatePicker.RangePicker
              value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : undefined}
              onChange={(v) => {
                if (v && v[0] && v[1]) {
                  setGlobalStore({
                    dateRange: [v[0].format("YYYY-MM-DD"), v[1].format("YYYY-MM-DD")],
                  });
                }
              }}
              allowClear={false}
            />
          )}
          fixSiderbar
          fixedHeader
        >
          <PageContainer title={false} breadcrumb={{ items: breadcrumbItems }}>
            {children}
          </PageContainer>
        </ProLayout>
      </div>
    </ProConfigProvider>
  );
}

export default AdminShell;
