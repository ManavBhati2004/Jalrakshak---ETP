"use client";

import { HeroSection } from "./hero-section";
import { AboutSlideshow } from "./about-slideshow";
import { ContactSection } from "./contact-section";

export function HomeContent() {
  return (
    <div className="relative bg-background">
      <HeroSection />
      <AboutSlideshow />
      <ContactSection />
    </div>
  );
}
