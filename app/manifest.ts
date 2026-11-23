import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tenant Message Copilot",
    short_name: "Copilot",
    description: "Grounded draft replies to tenant messages for a property manager. Nothing is ever sent to a tenant.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f2",
    theme_color: "#0f5c63",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }, { src: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  };
}
