import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, createCustomer, listCustomers } from "../api/client";

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { data: customers, isLoading } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createCustomer({ email, name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setEmail("");
      setName("");
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to add customer"),
  });

  return (
    <div>
      <h1 className="text-xl font-semibold">Customers</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
        </div>
        <button type="submit" disabled={createMutation.isPending} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white">
          Add customer
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </form>

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={2}>
                  Loading…
                </td>
              </tr>
            )}
            {customers?.map((c) => (
              <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2 text-neutral-500">{c.email}</td>
              </tr>
            ))}
            {customers?.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={2}>
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
