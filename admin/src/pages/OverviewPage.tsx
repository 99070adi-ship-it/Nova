import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function OverviewPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-xl font-semibold">Overview</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Signed in as <span className="font-medium text-neutral-700">{user?.full_name}</span> ({user?.role}).
      </p>

      <div className="mt-6 max-w-md rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Create My Store</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Tell NOVA about your brand and products — it turns raw input into a working store.
        </p>
        <Link to="/create-store" className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Start
        </Link>
      </div>

      <p className="mt-6 text-sm text-neutral-500">Store health, sales, and AI findings land here in later phases.</p>
    </div>
  );
}
