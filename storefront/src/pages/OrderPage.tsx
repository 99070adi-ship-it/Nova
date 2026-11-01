import { useParams } from "react-router-dom";
import { useStore } from "../components/StoreContext";
import { loadLastOrder } from "../lib/lastOrder";
import { useTitle } from "../lib/useTitle";
import { OrderDetails } from "../components/OrderDetails";
import OrderLookupForm from "./OrderLookupPage";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { info } = useStore();
  useTitle(`Order | ${info.store_name}`);
  const order = id ? loadLastOrder(id) : null;
  if (order) return <OrderDetails order={order} headline={order.replayed ? "Here's your order" : "Thank you, your demo order is in"} />;
  // Opened without the order we just placed (a new tab, an old link): ask for the order number and email.
  return <OrderLookupForm initialOrderId={id} />;
}
