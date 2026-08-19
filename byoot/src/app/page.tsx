import { ListingCard } from "@/components/ListingCard";

/**
 * Scaffold placeholder — not the real homepage. Renders one ListingCard
 * with synthetic props so `next build` exercises the component in an
 * actual route, not just in tests. Real data fetching, real routing, and
 * real design come later — see BYOOT_TRANSFORMATION_PLAN.md Section D.
 */
export default function Home() {
  return (
    <main>
      <h1>byoot/ — foundation scaffold</h1>
      <p>See byoot/README.md before treating anything here as production-ready.</p>
      <ListingCard
        id="scaffold-example"
        address="1 Example Street"
        city="Toronto"
        price={899_000}
        beds={3}
        baths={2}
        brokerageName="Example Realty Inc., Brokerage"
      />
    </main>
  );
}
