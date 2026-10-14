import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration, forgetRun, readHistory, rememberRun, resultPath, type Run } from "./runs";

const run = (kind: string, params: Record<string, unknown> = {}) => ({ id: "abc", kind, params_digest: params, inputs: [] }) as unknown as Run;

describe("exécutions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mène au bon écran de résultat", () => {
    expect(resultPath(run("explorer"))).toBe("/explorateur/abc");
    expect(resultPath(run("protein_comparison"))).toBe("/comparaison/abc");
    expect(resultPath(run("explorer_tree", { job: "parent" }))).toBe("/explorateur/parent?tab=phylogenie&arbre=abc");
    expect(resultPath(run("conservation", { accession: "P02945" }))).toBe("/structures/P02945?tab=evolution");
    expect(resultPath(run("deeptmhmm"))).toBeNull();
  });

  it("écrit les durées lisiblement", () => {
    expect(formatDuration(0.25)).toBe("250 ms");
    expect(formatDuration(12.34)).toBe("12.3 s");
    expect(formatDuration(185)).toBe("3 min 5 s");
    expect(formatDuration(null)).toBe("—");
  });

  it("garde un historique sans doublon, le plus récent en tête", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    rememberRun("a", "explorer");
    rememberRun("b", "conservation");
    rememberRun("a", "explorer");
    expect(readHistory().map((e) => e.id)).toEqual(["a", "b"]);
    forgetRun("a");
    expect(readHistory().map((e) => e.id)).toEqual(["b"]);
  });
});
