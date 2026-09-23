import { useAuth } from "../lib/auth";

export default function OverviewPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-xl font-semibold">Overview</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Signed in as <span className="font-medium text-neutral-700">{user?.full_name}</span> ({user?.role}).
      </p>
      <p className="mt-1 text-sm text-neutral-500">Store health, sales, and AI findings land here in later phases.</p>
    </div>
  );
}
