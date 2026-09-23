import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { adjustInventory, listInventory } from "../api/client";

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const { data: rows, isLoading } = useQuery({ queryKey: ["inventory"], queryFn: listInventory });

  const adjustMutation = useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) => adjustInventory(id, delta, delta > 0 ? "restock" : "manual adjustment"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory"] }),
  });

  return (
    <div>
      <h1 className="text-xl font-semibold">Inventory</h1>
      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">On hand</th>
              <th className="px-4 py-2">Reserved</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {rows?.map((r) => {
              const low = r.on_hand <= r.low_stock_threshold;
              return (
                <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-medium">{r.product_title}</td>
                  <td className="px-4 py-2 text-neutral-500">{r.sku}</td>
                  <td className={clsx("px-4 py-2", low ? "font-semibold text-amber-600" : "text-neutral-700")}>
                    {r.on_hand} {low && "(low)"}
                  </td>
                  <td className="px-4 py-2 text-neutral-500">{r.reserved}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => adjustMutation.mutate({ id: r.id, delta: 10 })}
                      className="mr-2 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                    >
                      +10
                    </button>
                    <button
                      onClick={() => adjustMutation.mutate({ id: r.id, delta: -1 })}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                    >
                      -1
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows?.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-neutral-400" colSpan={5}>
                  No inventory yet — add a product first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
