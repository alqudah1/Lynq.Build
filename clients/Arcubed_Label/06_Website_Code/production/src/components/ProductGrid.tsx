import type { Bag } from "@/lib/types";
import ProductCard from "./ProductCard";

export default function ProductGrid({ bags, className = "grid" }: { bags: Bag[]; className?: string }) {
  return (
    <div className={className}>
      {bags.map((bag) => (
        <ProductCard key={bag.id} bag={bag} />
      ))}
    </div>
  );
}
