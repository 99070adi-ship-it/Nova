import SLink from "../components/SLink";

export default function NotFound({ what = "page" }: { what?: string }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-28 text-center">
      <p className="sf-eyebrow">404</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">We couldn't find that {what}</h1>
      <p className="mt-3 text-muted">It may have moved or isn't available any more.</p>
      <SLink to="/products" className="sf-btn mt-8">Browse the shop</SLink>
    </div>
  );
}
