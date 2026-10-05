import { describe, expect, it } from "vitest";
import { buildTopology, niceStep, sideOf, type Region } from "./topology";

// Canal potassique KcsA (P0A334) : annotations UniProt
const kcsa: Region[] = [
  { start: 1, end: 27, type: "topological", label: "Cytoplasmic" },
  { start: 28, end: 50, type: "transmembrane", label: "Helical" },
  { start: 51, end: 61, type: "topological", label: "Extracellular" },
  { start: 62, end: 72, type: "intramembrane", label: "Helical; Pore-forming" },
  { start: 73, end: 80, type: "intramembrane", label: "Pore-forming" },
  { start: 75, end: 80, type: "motif", label: "Selectivity filter" },
  { start: 81, end: 87, type: "topological", label: "Extracellular" },
  { start: 88, end: 111, type: "transmembrane", label: "Helical" },
  { start: 112, end: 160, type: "topological", label: "Cytoplasmic" },
];

describe("buildTopology", () => {
  it("reconstruit la topologie de KcsA", () => {
    const t = buildTopology(kcsa, 160)!;
    expect(t.elements.map((e) => `${e.kind}:${e.start}-${e.end}`)).toEqual([
      "tm:28-50",
      "reentrant:62-80",
      "tm:88-111",
    ]);
    expect(t.loops.map((l) => l.side)).toEqual(["in", "out", "out", "in"]);
    expect(t.sidesAnnotated).toBe(true);
    expect(t.outsideName).toBe("Extracellulaire");
  });

  it("propage les côtés quand ils ne sont pas annotés", () => {
    const regions: Region[] = [
      { start: 10, end: 30, type: "transmembrane" },
      { start: 50, end: 70, type: "transmembrane" },
    ];
    const t = buildTopology(regions, 100)!;
    expect(t.sidesAnnotated).toBe(false);
    expect(t.loops.map((l) => l.side)).toEqual(["in", "out", "in"]);
  });

  it("renvoie null sans région membranaire", () => {
    expect(buildTopology([{ start: 1, end: 50, type: "domain" }], 100)).toBeNull();
  });
});

describe("utilitaires", () => {
  it("reconnaît les compartiments", () => {
    expect(sideOf("Cytoplasmic")).toBe("in");
    expect(sideOf("Lumenal")).toBe("out");
    expect(sideOf("Helical")).toBeNull();
  });

  it("choisit un pas de graduation rond", () => {
    expect(niceStep(413)).toBe(50);
    expect(niceStep(160)).toBe(20);
  });
});
