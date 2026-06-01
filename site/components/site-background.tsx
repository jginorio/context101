"use client";

import Aurora from "@/components/Aurora";
import { BrainConnectionBeams } from "@/components/brain-connection-beams";

export function SiteBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden
    >
      <BrainConnectionBeams />
      <div className="absolute inset-x-0 top-0 h-[min(72vh,680px)] opacity-[0.32]">
        <Aurora amplitude={0.72} blend={0.38} speed={0.28} />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,var(--bg)_82%)]" />
      <div
        className="absolute inset-0 opacity-[0.28] [background-image:linear-gradient(to_right,rgba(184,85,201,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(184,85,201,0.04)_1px,transparent_1px)] [background-size:3rem_3rem]"
        aria-hidden
      />
    </div>
  );
}
