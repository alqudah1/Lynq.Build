import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { brandPack, candidate, content, designProposal } from "../../../test/support/website-fixtures";
import { resolveDesignDirection } from "@/lib/office/website/design";
import { buildSiteEvidence } from "@/lib/office/website/evidence";
import { assembleSiteSpec } from "@/lib/office/website/spec";
import { DemoSitePage } from "./DemoSite";

/**
 * The generated sites are shown to a prospect's customers, not only to the
 * founder, so the component system carries the accessibility guarantees
 * rather than leaving them to whatever a generator happened to produce.
 */

const spec = assembleSiteSpec({
  projectKey: "SUMAC",
  route: "/demos/sumac",
  evidence: buildSiteEvidence({ candidate, brandPack }),
  design: resolveDesignDirection(designProposal),
  content,
});

describe("generated demo site", () => {
  it.each(spec.pages.map((page) => [page.path || "home", page.path] as const))("renders %s with no axe violations", async (_name, path) => {
    const { container } = render(<DemoSitePage spec={spec} path={path} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives every page one main landmark, one first-level heading and a working skip link", () => {
    for (const page of spec.pages) {
      const { container, unmount } = render(<DemoSitePage spec={spec} path={page.path} />);
      expect(container.querySelectorAll("main")).toHaveLength(1);
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      const skip = within(container).getByRole("link", { name: /skip to main content/i });
      expect(skip).toHaveAttribute("href", "#demo-main");
      expect(container.querySelector("#demo-main")).not.toBeNull();
      unmount();
    }
  });

  it("labels the navigation and points every item at a route the site emits", () => {
    render(<DemoSitePage spec={spec} path="" />);
    const nav = screen.getByRole("navigation", { name: spec.businessName });
    const routes = new Set(spec.pages.map((page) => (page.path ? `${spec.route}/${page.path}` : spec.route)));
    for (const link of within(nav).getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("tel:") || routes.has(href.split("#")[0]!)).toBe(true);
      expect(link.textContent?.trim()).toBeTruthy();
    }
  });

  it("discloses on every page that it is a concept rather than the business's own site", () => {
    for (const page of spec.pages) {
      const { container, unmount } = render(<DemoSitePage spec={spec} path={page.path} />);
      expect(container.textContent).toContain(spec.demoDisclosure);
      unmount();
    }
  });

  it("captures a booking enquiry without ever claiming to have sent it", () => {
    render(<DemoSitePage spec={spec} path="visit" />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Dana" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "dana@example.ca" } });
    fireEvent.change(screen.getByLabelText(/help with/i), { target: { value: "A table for the evening." } });
    const submit = screen.getByRole("button", { name: content.formSubmitLabel });
    fireEvent.submit(submit.closest("form")!);

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/does not send anything/i);
    expect(status.textContent).not.toMatch(/sent|received|thank you/i);
  });

  it("marks required fields and wires every control to a label", () => {
    const { container } = render(<DemoSitePage spec={spec} path="visit" />);
    const controls = [...container.querySelectorAll("input, textarea, select")];
    expect(controls.length).toBeGreaterThan(2);
    for (const control of controls) {
      const id = control.getAttribute("id");
      expect(id).toBeTruthy();
      expect(container.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
    expect(container.querySelectorAll("[required]").length).toBeGreaterThan(0);
  });

  it("gives every image alternative text carried from the approved asset", () => {
    const { container } = render(<DemoSitePage spec={spec} path="" />);
    const images = [...container.querySelectorAll("img")];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.getAttribute("alt")?.trim()).toBeTruthy();
      expect(spec.assets.some((asset) => asset.url === image.getAttribute("src"))).toBe(true);
    }
  });
});
