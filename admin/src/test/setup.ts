import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView — NovaSpotlight-driving code calls it on real elements.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}
