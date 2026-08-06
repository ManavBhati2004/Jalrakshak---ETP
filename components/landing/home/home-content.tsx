"use client";

import { HeroSection } from "./hero-section";
import { ProductWalkthrough } from "./product-walkthrough";

export function HomeContent() {
  return (
    <div className="relative bg-background">
      <HeroSection />
      <ProductWalkthrough />
    </div>
  );
}
