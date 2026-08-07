import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify(env.NEXT_PUBLIC_API_BASE || "/admin"),
      "process.env.NODE_ENV": JSON.stringify(mode),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      port: 3102,
      host: true,
      proxy: {
        "/admin": {
          target: env.API_PROXY_TARGET || "http://localhost:3100",
          changeOrigin: false,
        },
        "/reports": {
          target: env.API_PROXY_TARGET || "http://localhost:3100",
          changeOrigin: false,
        },
      },
    },
  };
});
