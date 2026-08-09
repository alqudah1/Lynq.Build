import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { InvitationStatusBanner } from "./InvitationStatusBanner";

const replaceMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/app/acme",
}));

describe("InvitationStatusBanner", () => {
  it("shows only the generic 'accepted' wording — never an internal reason", async () => {
    mockSearchParams = new URLSearchParams("invitation=accepted");
    const { container } = render(<InvitationStatusBanner />);

    expect(screen.getByRole("status")).toHaveTextContent("Invitation accepted.");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows only the generic 'failed' wording — never expired/revoked/email_mismatch/already_used/tenant_mismatch", () => {
    mockSearchParams = new URLSearchParams("invitation=failed");
    render(<InvitationStatusBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("This invitation could not be completed.");
    for (const forbidden of ["expired", "revoked", "email_mismatch", "already_used", "tenant_mismatch", "not_found"]) {
      expect(banner.textContent?.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("renders nothing for an unrecognized query value", () => {
    mockSearchParams = new URLSearchParams("invitation=something-unexpected");
    render(<InvitationStatusBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing when no invitation param is present", () => {
    mockSearchParams = new URLSearchParams();
    render(<InvitationStatusBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("strips the invitation query param from the URL after the initial render", () => {
    mockSearchParams = new URLSearchParams("invitation=accepted&foo=bar");
    replaceMock.mockClear();
    render(<InvitationStatusBanner />);

    expect(replaceMock).toHaveBeenCalledWith("/app/acme?foo=bar", { scroll: false });
  });

  it("can be dismissed explicitly", () => {
    mockSearchParams = new URLSearchParams("invitation=accepted");
    render(<InvitationStatusBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
