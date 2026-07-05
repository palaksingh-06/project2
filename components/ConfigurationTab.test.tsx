// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationTab } from "@/components/ConfigurationTab";

// This project's vitest config doesn't set `globals: true` / an RTL setup
// file, so DOM isn't auto-unmounted between tests within this file — without
// this, later tests would see accumulated elements from earlier renders.
afterEach(cleanup);

describe("ConfigurationTab", () => {
  it("pre-fills the driver rate from the truck profile", () => {
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={() => {}}
      />
    );
    const driverInput = screen.getByLabelText(/driver salary/i) as HTMLInputElement;
    expect(Number(driverInput.value)).toBeGreaterThan(0);
  });

  it("calls onChange with an override when a field is edited", () => {
    const onChange = vi.fn();
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={onChange}
      />
    );
    const driverInput = screen.getByLabelText(/driver salary/i);
    fireEvent.change(driverInput, { target: { value: "999" } });
    expect(onChange).toHaveBeenCalled();
    const [overridesArg] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(overridesArg.driver_per_day).toBe(999);
  });

  it("calls onChange with the head added to excludedHeads when its checkbox is unchecked", () => {
    const onChange = vi.fn();
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={onChange}
      />
    );
    const tyresCheckbox = screen.getByLabelText(/include tyres/i) as HTMLInputElement;
    fireEvent.click(tyresCheckbox);
    const [, excludedArg] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(excludedArg).toContain("tyres");
  });

  it("hides off-by-default add-ons behind a collapsed section", () => {
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={() => {}}
      />
    );
    expect(screen.queryByLabelText(/gps/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/add more components/i));
    expect(screen.getByLabelText(/gps/i)).toBeInTheDocument();
  });
});
