import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "antd/dist/reset.css";
import "./app/globals.css";

import AdminProvider from "./components/AdminProvider";
import AdminShell from "./app/(admin)/layout";

import DashboardPage from "./app/(admin)/dashboard/page";
import ReportsPage from "./app/(admin)/app/reports/page";
import FetchPage from "./app/(admin)/app/fetch/page";
import ContextsPage from "./app/(admin)/app/contexts/page";
import KeywordsPage from "./app/(admin)/app/keywords/page";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/*"
            element={
              <AdminShell>
                <Suspense fallback={<div>Loading...</div>}>
                  <Routes>
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="app/reports" element={<ReportsPage />} />
                    <Route path="app/fetch" element={<FetchPage />} />
                    <Route path="app/contexts" element={<ContextsPage />} />
                    <Route path="app/keywords" element={<KeywordsPage />} />
                    <Route path="" element={<Navigate to="dashboard" replace />} />
                    <Route path="*" element={<Navigate to="dashboard" replace />} />
                  </Routes>
                </Suspense>
              </AdminShell>
            }
          />
        </Routes>
      </BrowserRouter>
    </AdminProvider>
  </React.StrictMode>
);
