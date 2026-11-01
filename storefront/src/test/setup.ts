import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => cleanup());
