"use client";

import { useEffect, useRef } from "react";

type MolstarViewerProps = {
  pdbId: string;
};

export default function MolstarViewer({ pdbId }: MolstarViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let plugin: any = null;

    const init = async () => {
      if (!containerRef.current || !pdbId) return;

      const [{ PluginContext }, { DefaultPluginSpec }] = await Promise.all([
        import("molstar/lib/mol-plugin/context"),
        import("molstar/lib/mol-plugin/spec"),
      ]);

      const parent = containerRef.current;
      parent.innerHTML = "";

      const canvas = document.createElement("canvas");
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      parent.appendChild(canvas);

      plugin = new PluginContext(DefaultPluginSpec());
      await plugin.init();

      if (disposed) return;

      plugin.initViewer(canvas, parent);

      const url = `https://files.rcsb.org/download/${pdbId.toUpperCase()}.cif`;
      const data = await plugin.builders.data.download({
        url,
        isBinary: false,
      });

      const trajectory = await plugin.builders.structure.parseTrajectory(
        data,
        "mmcif"
      );

      await plugin.builders.structure.hierarchy.applyPreset(
        trajectory,
        "default"
      );
    };

    init();

    return () => {
      disposed = true;
      if (plugin?.dispose) plugin.dispose();
    };
  }, [pdbId]);

  return (
    <div
      ref={containerRef}
      className="h-[420px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-white"
    />
  );
}