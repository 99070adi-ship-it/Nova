import { Link } from "react-router-dom";

export default function StoreHeader({ storeName }: { storeName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
      <Link to="/" className="text-sm font-semibold tracking-tight">
        {storeName}
      </Link>
      <nav className="text-sm text-neutral-500">
        <Link to="/products" className="hover:text-neutral-900">
          Shop
        </Link>
      </nav>
    </header>
  );
}
