import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, listMessages, postMessage, startConversation } from "../api/client";

export default function AIWorkspacePage() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () => startConversation({ agent_key: "assistant", context: {} }),
    onSuccess: (conv) => setConversationId(conv.id),
  });

  useEffect(() => {
    startMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: messages } = useQuery({
    queryKey: ["ai-messages", conversationId],
    queryFn: () => listMessages(conversationId!),
    enabled: !!conversationId,
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => postMessage(conversationId!, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      setInput("");
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Message failed"),
  });

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] max-w-2xl flex-col">
      <h1 className="text-xl font-semibold">AI Workspace</h1>
      <p className="mt-1 text-sm text-neutral-500">Ask NOVA about your store. Sensitive actions go to Approvals.</p>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
        {messages?.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
            <span
              className={
                m.role === "user"
                  ? "inline-block max-w-[80%] rounded-2xl bg-neutral-900 px-4 py-2 text-sm text-white"
                  : "inline-block max-w-[80%] rounded-2xl bg-neutral-100 px-4 py-2 text-sm text-neutral-800"
              }
            >
              {m.content}
            </span>
          </div>
        ))}
        {(!messages || messages.length === 0) && <p className="text-sm text-neutral-400">Say hello — try "How is my store doing?"</p>}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && conversationId) sendMutation.mutate(input.trim());
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!conversationId || sendMutation.isPending}
          placeholder="Message NOVA…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!conversationId || sendMutation.isPending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sendMutation.isPending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
