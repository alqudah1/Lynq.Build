import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { DemoSitePage } from "@/components/demos/DemoSite";
import type { SiteSpec } from "./spec";

/**
 * A minimal, dependency-free renderer for the demo component system.
 *
 * The validator has to render every generated page before the branch is
 * pushed, and it runs inside the Next application — which forbids pulling
 * `react-dom/server` into the app's module graph. Rather than weaken the
 * guarantee, the demo components are deliberately pure and hook-free, and
 * this walker turns their element tree into HTML directly.
 *
 * Because it is a substitute for the real renderer, `render.test.ts`
 * checks it against `react-dom/server` on real generated sites and fails
 * if the two ever disagree about what the page contains. Nothing here is
 * trusted on its own.
 */

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const ATTRIBUTE_NAMES: Record<string, string> = {
  className: "class",
  htmlFor: "for",
  autoComplete: "autocomplete",
  crossOrigin: "crossorigin",
  dateTime: "datetime",
  maxLength: "maxlength",
  minLength: "minlength",
  noValidate: "novalidate",
  readOnly: "readonly",
  referrerPolicy: "referrerpolicy",
  rowSpan: "rowspan",
  colSpan: "colspan",
  tabIndex: "tabindex",
  srcSet: "srcset",
  useMap: "usemap",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function hyphenate(property: string): string {
  return property.startsWith("--") ? property : property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function styleString(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([property, value]) => `${hyphenate(property)}:${typeof value === "number" ? `${value}px` : String(value)}`)
    .join(";");
}

function attributes(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key" || key === "ref" || key === "dangerouslySetInnerHTML") continue;
    if (key.startsWith("on") && typeof value === "function") continue;
    if (value === null || value === undefined || value === false) continue;
    if (key === "style" && typeof value === "object") {
      const css = styleString(value as Record<string, unknown>);
      if (css) parts.push(`style="${escapeHtml(css)}"`);
      continue;
    }
    const name = ATTRIBUTE_NAMES[key] ?? key;
    if (value === true) {
      parts.push(`${name}=""`);
      continue;
    }
    parts.push(`${name}="${escapeHtml(String(value))}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function renderNode(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return escapeHtml(String(node));
  if (Array.isArray(node)) return node.map((child) => renderNode(child)).join("");
  if (!isValidElement(node)) {
    throw new Error("The demo renderer met a node it does not understand; the component system must stay plain elements");
  }

  const element = node as ReactElement<Record<string, unknown>>;
  const props = (element.props ?? {}) as Record<string, unknown>;

  if (element.type === Fragment) return renderNode(props.children as ReactNode);

  if (typeof element.type === "function") {
    const component = element.type as (input: Record<string, unknown>) => ReactNode;
    // The demo components are synchronous, hook-free and side-effect free,
    // which is what makes calling them directly safe here.
    return renderNode(component(props));
  }

  if (typeof element.type !== "string") {
    throw new Error("The demo renderer only supports intrinsic elements and plain function components");
  }

  const tag = element.type;
  const open = `<${tag}${attributes(props)}>`;
  if (VOID_ELEMENTS.has(tag)) return open;
  return `${open}${renderNode(props.children as ReactNode)}</${tag}>`;
}

/** Render one page of a generated site to HTML, exactly as the deployed route would. */
export function renderSpecPage(spec: SiteSpec, path: string): string {
  return renderNode(createElement(DemoSitePage, { spec, path }));
}
