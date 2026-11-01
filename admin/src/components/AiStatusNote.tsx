import { useQuery } from "@tanstack/react-query";
import { getAiStatus } from "../api/client";

/** Says which AI is answering, so a rule-based demo is never mistaken for a real language model and a missing key is visible. */
export default function AiStatusNote({ className = "" }: { className?: string }) {
  const { data } = useQuery({ queryKey: ["ai-status"], queryFn: () => getAiStatus(), staleTime: 5 * 60_000, retry: false });
  if (!data) return null;
  let text: string;
  if (data.config?.restart_required) text = "The AI settings in backend/.env changed after the server started. Restart the backend to use them.";
  else if (!data.real_ai) text = "Demo mode: NOVA's text replies come from built-in rules, not a language model.";
  else if (!data.credentials_configured) text = "The text AI isn't configured on this server yet (no API key), so NOVA can't answer here.";
  else text = `Text AI: ${data.model ?? data.provider}.`;
  return <p className={`text-[11px] text-fg-3 ${className}`} data-testid="ai-status-note">{text}</p>;
}
