import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { useAuth } from "./lib/auth";
import { getOnboardingProgress } from "./api/client";
import ActivityPage from "./pages/ActivityPage";
import AIWorkspacePage from "./pages/AIWorkspacePage";
import AnalyticsPage from "./pages/AnalyticsPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import CreateMyStorePage from "./pages/CreateMyStorePage";
import CustomersPage from "./pages/CustomersPage";
import InventoryPage from "./pages/InventoryPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import OrdersPage from "./pages/OrdersPage";
import OverviewPage from "./pages/OverviewPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import ProductsPage from "./pages/ProductsPage";
import SignupPage from "./pages/SignupPage";
import StoreBuilderPage from "./pages/StoreBuilderPage";

export function RequireAuth({ children }: { children?: React.ReactElement }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children ?? <Outlet />;
}

// Create My Store, Store Builder, and Overview are the three real screens the pipeline itself
// runs on (steps 1-6 on Create My Store, 6-9 on Store Builder, 10 on Overview) — they stay
// reachable throughout onboarding; everything else in the app is held behind this gate until
// onboarding_service reports every step complete (current_step === null). Re-checked from the
// server on every navigation — there is no client-only state (localStorage, a stale redirect) a
// user could use to reach the rest of the app early; a page refresh re-runs this same check from
// scratch. The landing page's video is the only "introduction" now (ARCHITECTURE.md checkpoint:
// one video, not two) — authenticating of any kind lands here directly, no separate welcome step.
export function RequireOnboardingComplete() {
  const { data: progress, isLoading } = useQuery({ queryKey: ["onboarding-progress"], queryFn: getOnboardingProgress });
  if (isLoading) return null;
  if (progress && progress.current_step !== null) return <Navigate to="/create-store" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/create-store" element={<CreateMyStorePage />} />
          <Route path="/store-builder" element={<StoreBuilderPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route element={<RequireOnboardingComplete />}>
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/marketing" element={<PlaceholderPage title="Marketing" phase="P8" />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/ai-workspace" element={<AIWorkspacePage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<PlaceholderPage title="Settings" phase="P2" />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
