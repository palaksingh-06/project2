// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostSourceBadge } from "@/components/CostSourceBadge";

describe("CostSourceBadge", () => {
  it("renders the real label with the real styling", () => {
    render(<CostSourceBadge source="real" />);
    expect(screen.getByText(/real/i)).toBeTruthy();
  });

  it("renders the proxy label", () => {
    render(<CostSourceBadge source="proxy" />);
    expect(screen.getByText(/proxy/i)).toBeTruthy();
  });

  it("renders the estimate label", () => {
    render(<CostSourceBadge source="estimate" />);
    expect(screen.getByText(/estimate/i)).toBeTruthy();
  });
});
