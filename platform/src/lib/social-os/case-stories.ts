/**
 * Highlight sets for LYNQ client work: a fixed run of stories per client,
 * posted once and kept in that client's highlight. Images are the client's
 * own photos and real screenshots of the site LYNQ built (never AI images of
 * the client), passed by file name at render time.
 */
import type { StorySpec } from "./story-original";

export interface CaseStory {
  spec: StorySpec;
  /** The client's photo or a real screenshot, by file name in the client folder. */
  image?: string;
}

const total = 7;
const folio = (n: number) => `${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
const series = "Case 04 · Arcubed Label";

/** ARCUBED highlight: hand crocheted bags, made to order, sold through a store LYNQ built. */
export const ARCUBED_CASE: CaseStory[] = [
  {
    image: "DSC05787.JPG",
    spec: { kind: "object", brand: "lynq", series, folio: folio(1), title: "Case 04 · Arcubed Label", label: [{ k: "Client", v: "Handmade crochet bags" }, { k: "Built", v: "Store, customizer, orders" }, { k: "Live", v: "Since October 2026" }], line: "Made by hand. Ordered online." },
  },
  {
    spec: { kind: "statement", brand: "lynq", series, folio: folio(2), label: "The brief", lines: ["Every bag is", "made by hand.", "Every order", "used to be, too."], accentWord: "hand.", byline: "Colour, size, delivery: all in DMs" },
  },
  {
    image: "_-375.png",
    spec: { kind: "screen", brand: "lynq", series, folio: folio(3), step: "01 · Choose", headline: ["Pick the shape.", "Then the colour."], detail: "Four shapes and sixteen colourways, then the size, the strap and the chain." },
  },
  {
    image: "_product_mini_luna-375.png",
    spec: { kind: "screen", brand: "lynq", series, folio: folio(4), step: "02 · See it", headline: ["Every bag,", "before it's made."], detail: "Shown in the colour they picked, with its price and how long it takes to make." },
  },
  {
    image: "m-cart-375.png",
    spec: { kind: "screen", brand: "lynq", series, folio: folio(5), step: "03 · Order", headline: ["Into the bag.", "Not into the DMs."], detail: "Made exactly the way they designed it, then checkout. Every order lands in one list." },
  },
  {
    spec: { kind: "index", brand: "lynq", series, folio: folio(6), headline: "What we built.", rows: [{ name: "Storefront", what: "Shop, about, FAQ, contact" }, { name: "Customizer", what: "Shape, colour, size, strap, chain" }, { name: "Ready for delivery", what: "Bags in stock, delivered next day" }, { name: "Checkout", what: "Cash on delivery, no card needed" }, { name: "Orders", what: "One list, every status" }], note: "Built end to end by LYNQ." },
  },
  {
    spec: { kind: "statement", brand: "lynq", series, folio: folio(7), label: "The result", lines: ["Now the store", "does the talking."], accentWord: "talking.", byline: "Sell what you make? DM AUDIT" },
  },
];
