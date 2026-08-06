import { Elysia } from "elysia";
import { dashboardRoutes } from "./routes/dashboard";
import { reportsRoutes } from "./routes/reports";
import { fetchRoutes } from "./routes/fetch";
import { keywordsRoutes } from "./routes/keywords";
import { contextsRoutes } from "./routes/contexts";
import { aiRoutes } from "./routes/ai";

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .use(dashboardRoutes)
  .use(reportsRoutes)
  .use(fetchRoutes)
  .use(keywordsRoutes)
  .use(contextsRoutes)
  .use(aiRoutes);
