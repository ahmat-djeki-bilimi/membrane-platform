"use client";

import { useEffect, useRef } from "react";
import type { GLViewer } from "3dmol";

type MiniProteinViewerProps = {
  pdbId: string;
  speed?: number;
};

export default function MiniProteinViewer({
  pdbId,
  speed = 1.2,
}: MiniProteinViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    let mounted = true;
    let viewer: GLViewer | null = null;
    let frameId = 0;

    const run = async () => {
      if (!hostRef.current) return;

      hostRef.current.innerHTML = "";

      const $3Dmol = await import("3dmol");
      if (!mounted || !hostRef.current) return;

      const res = await fetch(
        `https://files.rcsb.org/view/${pdbId.toUpperCase()}.pdb`
      );
      const pdbText = await res.text();

      if (!mounted || !hostRef.current) return;

      viewer = $3Dmol.createViewer(hostRef.current, {
        backgroundColor: "white",
      });

      viewer.clear();
      viewer.addModel(pdbText, "pdb");
      viewer.setStyle({}, { cartoon: { color: "spectrum" } });
      viewer.zoomTo();
      viewer.render();

      const animate = () => {
        if (!mounted || !viewer) return;
        viewer.rotate(speed);
        viewer.render();
        frameId = requestAnimationFrame(animate);
      };

      animate();
    };

    run().catch((err) => {
      console.error("Erreur MiniProteinViewer :", err);
    });

    return () => {
      mounted = false;
      if (frameId) cancelAnimationFrame(frameId);
      if (viewer) {
        try {
          viewer.clear();
          viewer.render();
        } catch {}
      }
      if (host) host.innerHTML = "";
    };
  }, [pdbId, speed]);

  return (
    <div className="mini-protein-viewer relative h-full w-full overflow-hidden rounded-2xl">
      <div
        ref={hostRef}
        className="h-full w-full"
        style={{ width: "100%", height: "100%" }}
      />

      <style jsx>{`
        .mini-protein-viewer :global(canvas) {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: static !important;
          inset: auto !important;
        }

        .mini-protein-viewer :global(div) {
          max-width: 100%;
          max-height: 100%;
        }
      `}</style>
    </div>
  );
}