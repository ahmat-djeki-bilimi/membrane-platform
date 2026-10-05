export default function SiteFooter() {
  return (
    <footer className="mt-auto bg-[#0b2545]">
      <div className="h-1 bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500" />
      <div className="flex w-full flex-col gap-2 px-4 py-4 text-[14px] text-blue-200 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <p>
          <span className="font-semibold text-white">MemProtScope</span> — plateforme
          d’analyse des protéines membranaires
        </p>
        <p>Données : UniProtKB · RCSB PDB · AlphaFold DB · DeepTMHMM · OPM</p>
      </div>
    </footer>
  );
}
