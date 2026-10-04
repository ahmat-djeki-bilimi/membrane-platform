"use client";

import { useEffect, useRef } from "react";
import * as $3Dmol from "3dmol";

export default function HeroProteinViewer() {
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!viewerRef.current) return;

    const element = viewerRef.current;
    element.innerHTML = "";

    const viewer = $3Dmol.createViewer(element, {
      backgroundColor: "white",
    });

    $3Dmol.download("pdb:1AFO", viewer, {}, () => {
      viewer.setStyle({ chain: "A" }, { cartoon: { color: "#2563eb" } });
      viewer.setStyle({ chain: "B" }, { cartoon: { color: "#06b6d4" } });
      viewer.setStyle({ chain: "C" }, { cartoon: { color: "#7c3aed" } });

      viewer.zoomTo();
      viewer.zoom(1.08);
      viewer.render();
    });

    const interval = window.setInterval(() => {
      viewer.rotate(1, "y");
      viewer.render();
    }, 75);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div ref={viewerRef} className="h-[285px] w-full rounded-[1.5rem]" />
    </div>
  );
}