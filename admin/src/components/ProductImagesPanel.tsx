import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, generateLifestyleImage, listProductImages } from "../api/client";

export default function ProductImagesPanel({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const { data: images, isLoading } = useQuery({ queryKey: ["product-images", productId], queryFn: () => listProductImages(productId) });
  const [environment, setEnvironment] = useState("studio");
  const [mood, setMood] = useState("minimal");
  const [error, setError] = useState<string | null>(null);

  const hasCanonical = images?.some((i) => i.role === "canonical") ?? false;

  const generateMutation = useMutation({
    mutationFn: () => generateLifestyleImage(productId, { environment, mood }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-images", productId] });
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Generation failed"),
  });

  return (
    <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3">
      {isLoading && <p className="text-xs text-neutral-400">Loading images…</p>}
      <div className="flex flex-wrap gap-2">
        {images?.map((img) => (
          <div key={img.id} className="w-20 text-center">
            <div className="aspect-square rounded-md bg-neutral-200" title={img.url} />
            <p className="mt-1 truncate text-[10px] text-neutral-500">{img.role === "canonical" ? "Original" : `${img.environment}/${img.mood}`}</p>
          </div>
        ))}
        {images?.length === 0 && <p className="text-xs text-neutral-400">No images yet.</p>}
      </div>

      {hasCanonical && (
        <div className="mt-3 flex items-end gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-neutral-500">Environment</label>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
              <option value="studio">Studio</option>
              <option value="luxury interior">Luxury interior</option>
              <option value="outdoor">Outdoor</option>
              <option value="street">Street</option>
              <option value="editorial">Editorial</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-neutral-500">Mood</label>
            <select value={mood} onChange={(e) => setMood(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
              <option value="minimal">Minimal</option>
              <option value="luxury">Luxury</option>
              <option value="casual">Casual</option>
              <option value="editorial">Editorial</option>
              <option value="bold">Bold</option>
            </select>
          </div>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-100"
          >
            {generateMutation.isPending ? "Generating…" : "Generate lifestyle image"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
      {!hasCanonical && !isLoading && <p className="mt-2 text-xs text-neutral-400">No original photo to generate from.</p>}
    </div>
  );
}
