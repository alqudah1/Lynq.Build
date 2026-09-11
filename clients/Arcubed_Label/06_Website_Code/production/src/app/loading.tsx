// Streaming placeholder for the homepage.
//
// This is what a visitor looks at between the shell being flushed and the
// page resolving, and on a cold serverless start over a phone connection that
// is not a short window. It is therefore not a spinner and not a blank field:
// it is the hero's GEOMETRY — pink wall, white floor at the same 42% split,
// a headline block where the headline goes and a product block where the bag
// goes — so the real hero replaces it without the page reflowing underneath.
//
// Its CSS is inlined in the root layout's <head> rather than imported here,
// because a stylesheet that arrives with the route cannot be relied on to
// style the shell that is painted before the route exists.
export default function Loading() {
  return (
    <div className="ed-hero" aria-busy="true" aria-label="Loading">
      <div className="ed-skel-block" />
      <div className="ed-skel-type" />
      <div className="ed-skel-object" />
    </div>
  );
}
