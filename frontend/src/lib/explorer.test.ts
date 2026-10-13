import { describe, expect, it } from "vitest";
import { pdbWithGrades, previewFasta, toCsv, type ExplorerPosition } from "./explorer";

describe("previewFasta", () => {
  it("compte les séquences et reconnaît un alignement", () => {
    const preview = previewFasta(">a desc\nMK-LV\n>b\nMKALV\n");
    expect(preview.error).toBeNull();
    expect(preview.records).toEqual([
      { header: "a desc", length: 4, aligned: true },
      { header: "b", length: 5, aligned: false },
    ]);
    expect(preview.prealigned).toBe(true);
  });

  it("refuse une séquence sans en-tête", () => {
    expect(previewFasta("MKV").error).not.toBeNull();
  });

  it("ignore les séquences vides et ne voit pas d'alignement sans gap", () => {
    const preview = previewFasta(">a\nMKV\n>vide\n\n>b\nMKL\n");
    expect(preview.records.map((r) => r.header)).toEqual(["a", "b"]);
    expect(preview.prealigned).toBe(false);
  });
});

describe("exports", () => {
  it("écrit le grade dans la colonne B-factor", () => {
    const line = "ATOM      1  CA  ALA A   2      11.000  12.000  13.000  1.00 90.00           C";
    const positions = [{ position: 2, grade: 9 }] as ExplorerPosition[];
    const out = pdbWithGrades(line, positions);
    expect(out.slice(60, 66)).toBe("  9.00");
    expect(out.slice(0, 60)).toBe(line.slice(0, 60));
  });

  it("protège les cellules CSV", () => {
    expect(toCsv(["a", "b"], [["x;y", 'dit "oui"']])).toBe('a;b\n"x;y";"dit ""oui"""\n');
  });
});
