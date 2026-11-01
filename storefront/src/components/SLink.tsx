import { Link, type LinkProps } from "react-router-dom";
import { storePath } from "../lib/store";
import { useStore } from "./StoreContext";

/** A link that keeps the selected store (and a draft preview) in the URL, so refreshes and shared links still work. */
export default function SLink({ to, ...rest }: Omit<LinkProps, "to"> & { to: string }) {
  const { org, preview, editor } = useStore();
  const external = /^https?:\/\//.test(to);
  if (external) return <a href={to} {...(rest as object)} />;
  return <Link to={storePath(to, org, preview, editor)} {...rest} />;
}

export function useStoreNav() {
  const { org, preview, editor } = useStore();
  return (to: string) => storePath(to, org, preview, editor);
}
