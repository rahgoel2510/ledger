import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The Rahul Goel HUF crest (public/logo.png, sourced from assets/Logo.png).
 * Detailed at full size — use generous sizes (>= 64px) wherever it needs to
 * read clearly; below that it still holds up as a recognizable silhouette.
 */
export function BrandLogo({
  size = 40,
  className,
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt="Rahul Goel HUF"
      width={512}
      height={512}
      priority={priority}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
