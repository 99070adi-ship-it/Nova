import { useQuery } from "@tanstack/react-query";
import { listActivity } from "../api/client";

const ACTOR_LABEL: Record<string, string> = { user: "You", ai: "AI", system: "System" };

export default function ActivityPage() {
  const { data: logs, isLoading } = useQuery({ queryKey: ["activity"], queryFn: listActivity });

  return (
    <div>
      <h1 className="text-xl font-semibold">Activity</h1>
      <p className="mt-1 text-sm text-neutral-500">Every action NOVA (or you) took — no hidden steps.</p>

      <div className="mt-4 space-y-1">
        {isLoading && <p className="text-sm text-neutral-400">Loading…</p>}
        {logs?.map((log) => (
          <div key={log.id} className="flex items-center gap-3 rounded-md border border-neutral-100 bg-white px-3 py-2 text-sm">
            <span className="w-32 shrink-0 text-xs text-neutral-400">{new Date(log.created_at).toLocaleTimeString()}</span>
            <span className="w-12 shrink-0 text-xs font-medium text-neutral-500">{ACTOR_LABEL[log.actor_type]}</span>
            <span className="font-mono text-xs">{log.action}</span>
            <span className="text-xs text-neutral-400">{log.entity_type}</span>
          </div>
        ))}
        {logs?.length === 0 && <p className="text-sm text-neutral-400">Nothing yet.</p>}
      </div>
    </div>
  );
}
