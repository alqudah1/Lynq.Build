import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ListingCard } from "./ListingCard";

describe("ListingCard", () => {
  it("renders brokerage attribution — the required prop this component exists to guarantee", () => {
    render(
      <ListingCard
        id="listing-1"
        address="123 Main St"
        city="Toronto"
        price={725_000}
        beds={3}
        baths={2}
        brokerageName="Test Realty Inc., Brokerage"
      />
    );

    expect(screen.getByTestId("listing-card-brokerage")).toHaveTextContent("Test Realty Inc., Brokerage");
  });

  it("renders price, address, and bed/bath count", () => {
    render(
      <ListingCard
        id="listing-2"
        address="456 Oak Ave"
        city="Oakville"
        price={1_250_000}
        beds={4}
        baths={3}
        brokerageName="Another Brokerage Ltd."
      />
    );

    expect(screen.getByTestId("listing-card-price")).toHaveTextContent("$1,250,000");
    expect(screen.getByTestId("listing-card-address")).toHaveTextContent("456 Oak Ave, Oakville");
    expect(screen.getByTestId("listing-card-beds-baths")).toHaveTextContent("4 bed");
    expect(screen.getByTestId("listing-card-beds-baths")).toHaveTextContent("3 bath");
  });

  it("falls back to a placeholder when no photo is available, rather than a broken image", () => {
    render(
      <ListingCard
        id="listing-3"
        address="789 Pine Rd"
        city={null}
        price={500_000}
        beds={2}
        baths={1}
        brokerageName="Third Brokerage Corp."
      />
    );

    expect(screen.getByTestId("listing-card-media-placeholder")).toBeInTheDocument();
  });
});
