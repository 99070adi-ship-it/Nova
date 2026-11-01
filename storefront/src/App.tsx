import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import EditorBridge from "./editor/EditorBridge";
import { StoreProvider } from "./components/StoreContext";
import CartPage from "./pages/CartPage";
import CheckoutPage from "./pages/CheckoutPage";
import CmsPage from "./pages/CmsPage";
import CollectionPage from "./pages/CollectionPage";
import HomePage from "./pages/HomePage";
import NotFound from "./pages/NotFound";
import OrderLookupPage from "./pages/OrderLookupPage";
import OrderPage from "./pages/OrderPage";
import ProductPage from "./pages/ProductPage";
import ShopPage from "./pages/ShopPage";
import WishlistPage from "./pages/WishlistPage";

export default function App() {
  return (
    <StoreProvider>
      <EditorBridge />
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ShopPage />} />
          <Route path="/products/:slug" element={<ProductPage />} />
          <Route path="/collections/:slug" element={<CollectionPage />} />
          <Route path="/pages/:slug" element={<CmsPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order/:id" element={<OrderPage />} />
          <Route path="/orders" element={<OrderLookupPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </StoreProvider>
  );
}
