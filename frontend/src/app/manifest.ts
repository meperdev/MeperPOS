import type { MetadataRoute } from "next";
import { buildManifest } from "@/lib/pwa";

/**
 * Served by Next at `/manifest.webmanifest`, which is also picked up
 * automatically by the link tag Next injects into every page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest();
}
