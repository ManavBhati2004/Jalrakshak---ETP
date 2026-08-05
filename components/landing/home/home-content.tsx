"use client";

import { HeroSection } from "./hero-section";
import { ProductWalkthrough } from "./product-walkthrough";
import { ContactSection } from "./contact-section";

export function HomeContent() {
  return (
    <div className="relative bg-background">
      <HeroSection />
      <ProductWalkthrough />
      <ContactSection />
    </div>
  );
}
