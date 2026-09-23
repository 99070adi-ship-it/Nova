import { useQuery } from "@tanstack/react-query";
import { getStorefront, listProducts } from "../api/client";
import ProductGrid from "../components/sections/ProductGrid";
import StoreHeader from "../components/StoreHeader";

export default function ProductsPage() {
  const { data: storefront } = useQuery({ queryKey: ["storefront"], queryFn: getStorefront });
  useQuery({ queryKey: ["public-products"], queryFn: listProducts });

  return (
    <div>
      <StoreHeader storeName={storefront?.store_name ?? "Store"} />
      <ProductGrid configuration={{ title: "All products", limit: 100 }} />
    </div>
  );
}
