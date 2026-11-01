import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { useAuth } from "./lib/auth";
import ActivityPage from "./pages/ActivityPage";
import AIWorkspacePage from "./pages/AIWorkspacePage";
import AnalyticsPage from "./pages/AnalyticsPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import CreateMyStorePage from "./pages/CreateMyStorePage";
import CustomersPage from "./pages/CustomersPage";
import InventoryPage from "./pages/InventoryPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import PhotoStudioPage from "./pages/PhotoStudioPage";
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

// There is deliberately no onboarding route gate. Every authenticated page is always reachable —
// the Guide (components/NovaGuideWidget.tsx, mounted once in AppLayout) is a persistent companion
// that reads the server-derived onboarding progress, navigates to the real page each step lives on,
// and offers a "Return to step" control if the visitor wanders off. Completion is only ever decided
// by backend state (onboarding_service.STEP_DEFINITIONS), so free navigation cannot fake progress,
// and every data endpoint keeps enforcing authentication and tenant isolation server-side.

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
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/marketing" element={<PlaceholderPage title="Marketing" phase="P8" />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/ai-workspace" element={<AIWorkspacePage />} />
          <Route path="/photo-studio" element={<PhotoStudioPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<PlaceholderPage title="Settings" phase="P2" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
