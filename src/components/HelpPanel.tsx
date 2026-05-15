import React from 'react';

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-ink border border-white/10 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-ink z-10">
          <h2 className="text-white font-semibold text-sm">Guide rapide</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1.5 touch-manipulation transition-colors">✕</button>
        </div>

        <div className="flex flex-col gap-6 p-4 text-xs">
          <Section title="🛠 Outils">
            <Row label="Stylo  P" desc="Dessin libre, sensible à la pression" />
            <Row label="Rectangle  R" desc="Glissez pour dessiner" />
            <Row label="Cercle  C" desc="Glissez pour dessiner" />
            <Row label="Texte  T" desc="Cliquez, écrivez, Entrée pour valider" />
            <Row label="Sélection  V" desc="Clic = sélectionner, glisser = marquee" />
            <Row label="Main  H" desc="Pan sans déplacer d'objets" />
            <Row label="Gomme  E" desc="Tap un objet pour l'effacer" />
            <Row label="Image  I" desc="Importer une image depuis l'appareil" />
          </Section>

          <Section title="🧭 Navigation & gestes">
            <Row label="Pincer" desc="Zoomer / dézoomer" />
            <Row label="2 doigts glisser" desc="Panoramique" />
            <Row label="Double-tap forme" desc="Entrer dans une scène imbriquée" />
            <Row label="Dézoomer" desc="Sortir de la scène courante" />
            <Row label="Breadcrumb (haut)" desc="Cliquer pour remonter d'un niveau" />
            <Row label="← Retour (bas)" desc="Remonter au niveau parent" />
          </Section>

          <Section title="🌀 Scènes imbriquées">
            <Row label="Créer" desc="Double-tap sur n'importe quel objet" />
            <Row label="Entrer" desc="Double-tap ou bouton Z (desktop)" />
            <Row label="Sortir" desc="Dézoomez suffisamment ou ← Retour" />
            <Row label="Profondeur" desc="Illimitée — chaque scène peut contenir des scènes" />
          </Section>

          <Section title="💬 Interactivité">
            <Row label="Hotspot 💬" desc="Sélectionner → ⚙ → Propriétés: info-bulle ou fenêtre au tap" />
            <Row label="Portal 🌀" desc="Sélectionner → ⚙ → Propriétés: lien vers une autre scène" />
            <Row label="Animation ✨" desc="Sélectionner → ⚙ → Propriétés: pulse, wobble, float, fade" />
            <Row label="Mode Viewer ✎" desc="Bouton en haut — active hotspots et portals" />
          </Section>

          <Section title="⌨️ Raccourcis (desktop)">
            <Row label="Ctrl+Z / Ctrl+Y" desc="Annuler / Refaire" />
            <Row label="Ctrl+C / Ctrl+V" desc="Copier / Coller la sélection" />
            <Row label="Ctrl+G / Ctrl+⇧+G" desc="Grouper / Dégrouper" />
            <Row label="Ctrl+A" desc="Tout sélectionner" />
            <Row label="Delete / Backspace" desc="Supprimer la sélection" />
            <Row label="Shift + coin resize" desc="Conserver les proportions" />
            <Row label="Z" desc="Entrer dans l'objet sélectionné" />
            <Row label="Espace (maintenu)" desc="Activer la main temporairement" />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-accent text-[11px] font-semibold uppercase tracking-wider">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Row({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-gray-200 font-medium min-w-[130px] flex-shrink-0">{label}</span>
      <span className="text-gray-500 leading-relaxed">{desc}</span>
    </div>
  );
}
