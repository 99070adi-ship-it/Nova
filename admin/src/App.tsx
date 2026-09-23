import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { useAuth } from "./lib/auth";
import ActivityPage from "./pages/ActivityPage";
import AIWorkspacePage from "./pages/AIWorkspacePage";
import AnalyticsPage from "./pages/AnalyticsPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import CreateMyStorePage from "./pages/CreateMyStorePage";
import CustomersPage from "./pages/CustomersPage";
import InventoryPage from "./pages/InventoryPage";
import LoginPage from "./pages/LoginPage";
import OrdersPage from "./pages/OrdersPage";
import OverviewPage from "./pages/OverviewPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import ProductsPage from "./pages/ProductsPage";
import StoreBuilderPage from "./pages/StoreBuilderPage";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/create-store" element={<CreateMyStorePage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/marketing" element={<PlaceholderPage title="Marketing" phase="P8" />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/ai-workspace" element={<AIWorkspacePage />} />
        <Route path="/store-builder" element={<StoreBuilderPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/settings" element={<PlaceholderPage title="Settings" phase="P2" />} />
        <Route index element={<Navigate to="/overview" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
