import { beforeEach, describe, expect, it } from "vitest";
import { cart, cartCount, readCart, setCartStore } from "./cart";

beforeEach(() => setCartStore("velora-test"));

describe("cart (variant ids and quantities only)", () => {
  it("adds, merges and counts", () => {
    cart.add("v1", 1);
    cart.add("v1", 2);
    cart.add("v2", 1);
    expect(readCart()).toEqual([{ variantId: "v1", quantity: 3 }, { variantId: "v2", quantity: 1 }]);
    expect(cartCount(readCart())).toBe(4);
  });

  it("never goes above the maximum it is given, and says so", () => {
    expect(cart.add("v1", 5, 3)).toEqual({ added: 3, capped: true });
    expect(cart.add("v1", 1, 3)).toEqual({ added: 0, capped: true });
    expect(readCart()[0].quantity).toBe(3);
  });

  it("ignores non-positive and fractional quantities", () => {
    cart.add("v1", 0);
    cart.add("v1", -4);
    expect(readCart()).toEqual([]);
    cart.add("v1", 2.9);
    expect(readCart()[0].quantity).toBe(2);
  });

  it("setQuantity clamps, and below one removes the line", () => {
    cart.add("v1", 2);
    cart.setQuantity("v1", 99, 4);
    expect(readCart()[0].quantity).toBe(4);
    cart.setQuantity("v1", 0);
    expect(readCart()).toEqual([]);
  });

  it("persists per store and never mixes stores", () => {
    cart.add("v1", 1);
    setCartStore("another-store");
    expect(readCart()).toEqual([]);
    setCartStore("velora-test");
    expect(readCart()).toEqual([{ variantId: "v1", quantity: 1 }]);
  });

  it("survives a corrupted or tampered stored cart: junk is dropped, never trusted", () => {
    window.localStorage.setItem("nova.store.cart.v1:velora-test", "not json");
    expect(readCart()).toEqual([]);
    window.localStorage.setItem("nova.store.cart.v1:velora-test", JSON.stringify([{ variantId: "a", quantity: 2, price: 0.01 }, { variantId: 5, quantity: 1 }, { variantId: "b", quantity: -1 }, { variantId: "a", quantity: 1 }]));
    expect(readCart()).toEqual([{ variantId: "a", quantity: 3 }]); // merged; the extra `price` field is not even kept
    expect(JSON.stringify(readCart())).not.toContain("price");
  });

  it("caps the number of lines", () => {
    for (let i = 0; i < 40; i++) cart.add(`v${i}`, 1);
    expect(readCart().length).toBeLessThanOrEqual(30);
  });
});
