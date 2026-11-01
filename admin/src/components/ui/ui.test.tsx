import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApprovalBar, Badge, Button, buttonClass, DiffRows, EmptyState, ErrorState, InsightCard, LoadingState, NavCount, NavItem, ProposalCard, StatTile, Table, Td, Th, Tr } from "./index";

describe("Button", () => {
  it("defaults to type=button (never submits a form by accident) and forwards data attributes the Guide targets", () => {
    render(<Button data-nova-target="x.y">Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveAttribute("data-nova-target", "x.y");
  });

  it("reserves Corona for the ai variant and ink for primary", () => {
    expect(buttonClass({ variant: "ai" })).toContain("bg-corona");
    expect(buttonClass({ variant: "primary" })).toContain("bg-inverse");
    expect(buttonClass({ variant: "primary" })).not.toContain("bg-corona");
  });

  it("is inert when disabled", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Nope</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Badge", () => {
  it("shows a label and a dot, so state is never colour alone; proposed is dashed", () => {
    const { container } = render(<Badge tone="proposed">Proposed</Badge>);
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
    expect(container.firstElementChild?.className).toContain("border-dashed");
  });
});

describe("StatTile / InsightCard", () => {
  it("StatTile renders label, value and hint with tabular numerals", () => {
    render(<StatTile label="Revenue" value="$13,655" hint="Avg order $258" />);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("$13,655").className).toContain("tabular-nums");
    expect(screen.getByText("Avg order $258")).toBeInTheDocument();
  });

  it("InsightCard shows the claim, its evidence and the actions", () => {
    render(
      <InsightCard
        badge={<Badge tone="danger">At risk</Badge>}
        source="Inventory Agent"
        title="4 products low"
        evidence={{ text: "get_low_stock_products" }}
        actions={<Button>View</Button>}
      />,
    );
    expect(screen.getByText("4 products low")).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.getByText("get_low_stock_products")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
  });
});

describe("ProposalCard / ApprovalBar", () => {
  it("a proposed card is visibly not-yet-real: dashed border and a 'nothing has changed' line", () => {
    const { container } = render(<ProposalCard stage="proposed" title="Win back customers" />);
    expect(container.firstElementChild?.className).toContain("border-dashed");
    expect(screen.getByText(/Nothing has changed yet/)).toBeInTheDocument();
  });

  it("an applied card is solid and drops that line", () => {
    const { container } = render(<ProposalCard stage="applied" title="Done" />);
    expect(container.firstElementChild?.className).not.toContain("border-dashed");
    expect(screen.queryByText(/Nothing has changed yet/)).not.toBeInTheDocument();
  });

  it("ApprovalBar routes Approve and Reject to their own handlers, and never autofocuses Approve", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ApprovalBar onApprove={onApprove} onReject={onReject} />);
    expect(screen.getByRole("button", { name: "Approve" })).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("ApprovalBar disables both decisions while one is in flight", () => {
    render(<ApprovalBar onApprove={vi.fn()} onReject={vi.fn()} pending />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("DiffRows renders each labelled row", () => {
    render(<DiffRows rows={[{ label: "Audience", value: "5 customers" }]} />);
    expect(screen.getByText("Audience")).toBeInTheDocument();
    expect(screen.getByText("5 customers")).toBeInTheDocument();
  });
});

describe("states", () => {
  it("EmptyState names what will appear; LoadingState announces itself; ErrorState offers a retry", () => {
    const retry = vi.fn();
    render(
      <>
        <EmptyState title="No proposals" body="They will appear here." />
        <LoadingState label="Reading orders…" />
        <ErrorState title="Couldn't read inventory" body="Nothing was changed." onRetry={retry} />
      </>,
    );
    expect(screen.getByText("No proposals")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reading orders…");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't read inventory");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("Table / NavItem", () => {
  it("Table renders header and rows, highlighting a row NOVA references", () => {
    const { container } = render(
      <Table>
        <thead>
          <tr><Th>Product</Th></tr>
        </thead>
        <tbody>
          <Tr highlight><Td num>2</Td></Tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(container.querySelector("tr.bg-corona-soft\\/60")).not.toBeNull();
    expect(screen.getByText("2").className).toContain("tabular-nums");
  });

  it("NavItem marks the current route and shows a count badge", () => {
    render(
      <MemoryRouter initialEntries={["/approvals"]}>
        <NavItem to="/approvals" badge={<NavCount n={3} />}>Approvals</NavItem>
        <NavItem to="/products">Products</NavItem>
      </MemoryRouter>,
    );
    const active = screen.getByRole("link", { name: /Approvals/ });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: "Products" })).not.toHaveAttribute("aria-current");
  });
});
