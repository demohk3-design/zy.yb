import React from "react";
import {
  DashboardOutlined,
  FileSearchOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  TagOutlined,
} from "@ant-design/icons";

export interface MenuItemConfig {
  key?: string;
  name: string;
  path?: string;
  icon?: React.ReactNode;
  children?: MenuItemConfig[];
}

export const MENU_CONFIG: MenuItemConfig[] = [
  {
    name: "概览",
    path: "/dashboard",
    icon: <DashboardOutlined />,
  },
  {
    name: "研报库",
    path: "/app/reports",
    icon: <FileSearchOutlined />,
  },
  {
    name: "抓取任务",
    path: "/app/fetch",
    icon: <ThunderboltOutlined />,
  },
  {
    name: "投喂包",
    path: "/app/contexts",
    icon: <FileTextOutlined />,
  },
  {
    name: "关键词",
    path: "/app/keywords",
    icon: <TagOutlined />,
  },
];

export const findFirstMenuPath = (items: MenuItemConfig[]): string => {
  for (const item of items) {
    if (Array.isArray(item.children) && item.children.length > 0) {
      const childPath = findFirstMenuPath(item.children);
      if (childPath) return childPath;
    }
    if (typeof item.path === "string" && item.path) {
      return item.path;
    }
  }
  return "/dashboard";
};
