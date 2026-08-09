import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { InvitationAcceptButton } from "./InvitationAcceptButton";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe("InvitationAcceptButton", () => {
  it("shows a pending state while the request is in flight, with no axe violations", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    const { container } = render(<InvitationAcceptButton />);

    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
    expect(screen.getByRole("button", { name: /accepting/i })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();

    resolveFetch({ ok: true, json: async () => ({ data: { outcome: "accepted" } }) });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Invitation accepted."));
  });

  it("shows a generic error message on failure — never the response's specific error code", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { code: "email_mismatch", message: "wrong email" } }) });
    const { container } = render(<InvitationAcceptButton />);

    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This invitation could not be completed.");
    expect(alert).not.toHaveTextContent(/email_mismatch|wrong email/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("treats an unexpected network failure identically to a generic error", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    render(<InvitationAcceptButton />);

    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This invitation could not be completed.");
  });

  it("shows a link into the dashboard after a successful accept", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { outcome: "already_member" } }) });
    render(<InvitationAcceptButton />);

    fireEvent.click(screen.getByRole("button", { name: /accept invitation/i }));

    const link = await screen.findByRole("link", { name: /continue to lynq/i });
    expect(link).toHaveAttribute("href", "/app");
  });

  it("supports a custom label for the retry case", () => {
    render(<InvitationAcceptButton label="Try again" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
