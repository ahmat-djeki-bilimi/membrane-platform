"use client";

import { useEffect, useRef } from "react";

export default function MiniStructureViewer() {
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let mounted = true;
    let viewer: any = null;

    const initViewer = async () => {
      const $3Dmol = await import("3dmol");

      if (!mounted || !viewerRef.current) return;

      const element = viewerRef.current;
      element.innerHTML = "";

      viewer = $3Dmol.createViewer(element, {
        backgroundColor: "white",
      });

      $3Dmol.download("pdb:1AFO", viewer, {}, () => {
        if (!mounted) return;

        viewer.setStyle({ chain: "A" }, { cartoon: { color: "#2563eb" } });
        viewer.setStyle({ chain: "B" }, { cartoon: { color: "#06b6d4" } });
        viewer.setStyle({ chain: "C" }, { cartoon: { color: "#7c3aed" } });

        viewer.zoomTo();
        viewer.zoom(0.78);
        viewer.render();

        intervalId = setInterval(() => {
          if (!mounted) return;
          viewer.rotate(1, "y");
          viewer.render();
        }, 120);
      });
    };

    initViewer();

    return () => {
      mounted = false;

      if (intervalId) clearInterval(intervalId);
      if (viewer) viewer.clear(); // 🔥 important pour éviter bugs
    };
  }, []);

  return (
    <div className="flex items-center justify-center">
      <div
        ref={viewerRef}
        className="h-[74px] w-[118px] rounded-lg border border-slate-200 bg-white"
      />
    </div>
  );
}