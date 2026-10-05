"use client";

import { memo, useMemo } from "react";
import { getAAColor, type MotifHit, type TMSegment } from "../../lib/sequence";

const ROW_LENGTH = 60;
const GROUP = 10;

// Chaque ligne est mémorisée : déplacer le curseur ne redessine que les lignes
// concernées, ce qui garde la page fluide sur des séquences de plusieurs
// dizaines de milliers de résidus.
export default function SequenceViewer({
  sequence,
  segments,
  selectedSegment,
  motifHits,
  cursor,
  onResidueClick,
}: {
  sequence: string;
  segments: TMSegment[];
  selectedSegment: number | null;
  motifHits: MotifHit[];
  cursor: number;
  onResidueClick?: (position: number) => void;
}) {
  const tmIndex = useMemo(() => {
    const arr = new Int32Array(sequence.length + 2).fill(-1);
    segments.forEach((s, i) => {
      for (let p = s.start; p <= s.end && p <= sequence.length; p++) arr[p] = i;
    });
    return arr;
  }, [sequence, segments]);

  const motifMask = useMemo(() => {
    const arr = new Uint8Array(sequence.length + 2);
    for (const h of motifHits) for (let p = h.start; p <= h.end; p++) arr[p] = 1;
    return arr;
  }, [sequence, motifHits]);

  const rows = useMemo(() => {
    const out: number[] = [];
    for (let i = 1; i <= sequence.length; i += ROW_LENGTH) out.push(i);
    return out;
  }, [sequence]);

  const selected = selectedSegment !== null ? segments[selectedSegment] : null;

  return (
    <div className="max-h-[360px] overflow-auto rounded-md border border-slate-200 bg-white p-3 font-mono text-[14px] leading-6">
      {rows.map((start) => {
        const end = Math.min(start + ROW_LENGTH - 1, sequence.length);
        return (
          <SequenceRow
            key={start}
            start={start}
            text={sequence.slice(start - 1, end)}
            tmIndex={tmIndex}
            motifMask={motifMask}
            cursor={cursor >= start && cursor <= end ? cursor : 0}
            selected={
              selected && selected.start <= end && selected.end >= start ? selectedSegment! : -1
            }
            onResidueClick={onResidueClick}
          />
        );
      })}
    </div>
  );
}

const SequenceRow = memo(function SequenceRow({
  start,
  text,
  tmIndex,
  motifMask,
  cursor,
  selected,
  onResidueClick,
}: {
  start: number;
  text: string;
  tmIndex: Int32Array;
  motifMask: Uint8Array;
  cursor: number;
  selected: number;
  onResidueClick?: (position: number) => void;
}) {
  return (
    <div className="flex gap-4 whitespace-nowrap">
      <span className="w-[52px] shrink-0 select-none text-right text-slate-400">{start}</span>
      <span className="text-slate-800">
        {text.split("").map((aa, idx) => {
          const position = start + idx;
          const tm = tmIndex[position];
          const isTM = tm !== -1;
          const isSelectedTM = isTM && tm === selected;
          const isMotif = motifMask[position] === 1;
          const isCursor = position === cursor;

          let color = getAAColor(aa);
          if (isMotif) color = "bg-amber-300 text-amber-950 font-semibold";
          if (isSelectedTM) color = "bg-blue-600 text-white";
          if (isCursor) color = "bg-rose-500 text-white";

          return (
            <span
              id={`aa-${position}`}
              key={position}
              title={`${aa}${position}${isTM ? ` · TM${tm + 1}` : ""}${isMotif ? " · motif" : ""}`}
              onClick={onResidueClick ? () => onResidueClick(position) : undefined}
              className={[
                "inline-block cursor-default px-[1px]",
                color,
                isTM && !isSelectedTM && !isCursor
                  ? "underline decoration-blue-600 decoration-2 underline-offset-2"
                  : "",
                (idx + 1) % GROUP === 0 ? "mr-2" : "",
              ].join(" ")}
            >
              {aa}
            </span>
          );
        })}
      </span>
    </div>
  );
});
