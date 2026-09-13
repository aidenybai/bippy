import { HeroImages } from "@/components/hero-images";

export default function GalleryPage() {
  return <HeroImages isAboveTheFold={Date.now() % 2 === 0} />;
}
