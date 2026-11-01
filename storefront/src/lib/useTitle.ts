import { useEffect } from "react";

export function useTitle(title: string | undefined, description?: string | null) {
  useEffect(() => {
    if (title) document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && description) meta.setAttribute("content", description);
  }, [title, description]);
}
