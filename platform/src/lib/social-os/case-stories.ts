/**
 * Highlight sets for LYNQ client work, rendered by `composeCaseFrame`.
 * Every image is the client's own photo or a real screenshot of the site
 * LYNQ built (never an AI image of the client). Copy names no city, makes no
 * claim the client's site doesn't make, and shows no testimonial.
 */
import type { CaseSet } from "./case-render";

/** ARCUBED highlight: hand crocheted bags, made to order, sold through a store LYNQ built. */
export const ARCUBED_CASE: CaseSet = {
  series: "Case 04 · Arcubed Label",
  glow: "#f7a8e6",
  frames: [
    { kind: "cover", photo: "DSC05787.JPG", caseNo: "Case 04", name: ["Arcubed", "Label"], line: "Hand crocheted bags, made to order." },
    { kind: "brief", photo: "DSC05781.JPG", label: "The brief", lines: ["Every bag is", "made by hand.", "Every order", "used to be, too."], accentWord: "hand.", byline: "Colour, size, delivery: all in DMs" },
    { kind: "phones", step: "01 · Choose", headline: ["Pick the shape.", "Then the colour."], detail: "Four shapes and sixteen colourways, then the size, the strap and the chain.", shots: [{ img: "_-375.png" }] },
    { kind: "phones", step: "02 · See it", headline: ["Every bag,", "before it's made."], detail: "Shown in their colour, with its price and how long it takes to make.", shots: [{ img: "_shop-375.png" }, { img: "_product_mini_luna-375.png" }] },
    { kind: "phones", step: "03 · Order", headline: ["Into the bag.", "Not into the DMs."], detail: "Made exactly the way they designed it, then checkout. Every order lands in one list.", shots: [{ img: "m-cart-375.png" }] },
    {
      kind: "bento",
      headline: "One store.",
      tiles: [
        { shot: { img: "_shop-375.png" }, label: "Storefront", sub: "Shop, about, FAQ" },
        { shot: { img: "_-375.png" }, label: "Customizer", sub: "Shape, colour, strap" },
        { shot: { img: "_ready_for_delivery-375.png" }, label: "Ready now", sub: "In stock, next day" },
        { shot: { img: "m-cart-375.png" }, label: "Checkout", sub: "Cash on delivery" },
      ],
      note: "Built end to end by LYNQ.",
    },
    { kind: "cta", photo: "DSC04878.JPG", lines: ["Now the store", "does the talking."], accentWord: "talking.", button: "DM AUDIT" },
  ],
};

/** HOUSE DEALS highlight: a direct-purchase property company with an investor side, on one site. */
export const HOUSE_DEALS_CASE: CaseSet = {
  series: "Case 05 · House Deals Direct",
  glow: "#2f8f5b",
  frames: [
    { kind: "cover", photo: "dusk-house.jpg", caseNo: "Case 05", name: ["House Deals", "Direct"], line: "Buys homes direct. Offers deals to investors." },
    { kind: "brief", photo: "aerial-rooftops.jpg", label: "The brief", lines: ["One business,", "two audiences,", "one site."], accentWord: "one site.", byline: "Owners who want to sell · investors who want deals" },
    { kind: "phones", step: "01 · Sell", headline: ["Sell without", "listing it."], detail: "The address first, then two short steps. About a minute, no obligation.", shots: [{ img: "home.png" }] },
    { kind: "phones", step: "02 · The process", headline: ["Four steps.", "Decide at each one."], detail: "Owners see exactly what happens next, and choose at every step whether to keep going.", shots: [{ img: "sell.png", y: 3330 }, { img: "how.png", y: 1150 }] },
    { kind: "phones", step: "03 · Invest", headline: ["The investor side.", "Estimates labelled."], detail: "Investors join a list with what they buy. Every estimate is marked as an estimate.", shots: [{ img: "investors.png" }, { img: "investors.png", y: 5050 }] },
    {
      kind: "bento",
      headline: "One site, both sides.",
      tiles: [
        { shot: { img: "home.png", y: 1280 }, label: "Seller form", sub: "Three short steps" },
        { shot: { img: "sell.png", y: 3330 }, label: "How it works", sub: "Four steps, both sides" },
        { shot: { img: "investors.png", y: 5050 }, label: "Investor list", sub: "What they buy" },
        { shot: { img: "faq.png" }, label: "FAQ", sub: "Sellers and investors" },
      ],
      note: "Built end to end by LYNQ.",
    },
    { kind: "cta", photo: "interior.jpg", lines: ["One site.", "Both sides served."], accentWord: "served.", button: "DM AUDIT" },
  ],
};
