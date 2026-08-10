import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Shared brand mark. `size` maps to a fixed pixel height so the logo stays
 * crisp at both the small sidebar/header scale and the larger login scale,
 * rather than stretching one <img> across very different layouts.
 */
export function Logo({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const height = size === "sm" ? 28 : size === "lg" ? 64 : 36;
  const width = Math.round(height * 1.6);

  return (
    <Image
      src="/brand/frye-law-group-logo.png"
      alt="Frye Law Group"
      height={height}
      width={width}
      priority
      className={cn("h-auto w-auto object-contain", className)}
    />
  );
}
