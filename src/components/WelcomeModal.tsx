import { useState } from 'react';

const SLIDES = [
  {
    emoji: '✏️',
    title: 'Canvas infini',
    desc: 'Dessinez librement sans limite de taille. Pincez pour zoomer, glissez pour naviguer.',
    tips: ['Molette / pincement → zoom', 'Espace + glisser → déplacer la vue', 'F → tout afficher'],
    accent: '#6c63ff',
  },
  {
    emoji: '🔭',
    title: 'Zoom sans fin',
    desc: "Zoomez à l'intérieur d'une forme pour entrer dans un nouveau monde. La transition est continue, sans aucune interruption.",
    tips: ['Zoomez fort sur une forme → vous entrez dedans', 'Dézoomez → vous en ressortez', 'Double-tapez → entrer en un clic'],
    accent: '#22c55e',
  },
  {
    emoji: '🌀',
    title: 'Mondes imbriqués',
    desc: "Chaque objet peut contenir un univers entier. Créez des niveaux de profondeur illimités — un schéma dans un schéma dans un schéma.",
    tips: ['Double-tapez une forme → nouvelle scène', 'Breadcrumb en haut → naviguez', 'Z → entrer dans la sélection'],
    accent: '#6c63ff',
  },
  {
    emoji: '💬',
    title: 'Rendez-le interactif',
    desc: 'Ajoutez des hotspots (info-bulles, fenêtres), des portals entre scènes et des animations. Activez le mode Viewer pour explorer.',
    tips: ['Sélectionnez → ⚙ Propriétés', '▶ en haut → mode exploration', 'Caméras → tour guidé'],
    accent: '#f59e0b',
  },
  {
    emoji: '⬆️',
    title: 'Exportez',
    desc: 'Exportez en HTML interactif autonome ou en SVG. Sauvegarde automatique dans le navigateur.',
    tips: ['Ctrl+E → Export', 'Share → lien compressé', 'Ctrl+S → sauvegarder'],
    accent: '#ec4899',
  },
];

export function WelcomeModal({ onClose }: { onClose: () => void }) {
  const [slide, setSlide] = useState(0);
  const s = SLIDES[slide];
  const isLast = slide === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-ink border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">
        <div className="flex flex-col items-center gap-3 px-8 pt-8 pb-5 text-center">
          <div className="text-5xl select-none">{s.emoji}</div>
          <h2 className="text-white text-xl font-bold">{s.title}</h2>
          <p className="text-gray-300 text-sm leading-relaxed">{s.desc}</p>
          <div className="w-full flex flex-col gap-1.5 mt-1">
            {s.tips.map((tip, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/8">
                <span className="text-accent text-xs font-mono flex-shrink-0">›</span>
                <span className="text-gray-400 text-xs text-left">{tip}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="text-gray-500 text-sm hover:text-gray-300 transition-colors touch-manipulation px-1 py-1"
          >
            Passer
          </button>
          <div className="flex gap-2 items-center">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className={`rounded-full transition-all touch-manipulation ${i === slide ? 'w-4 h-2 bg-accent' : 'w-2 h-2 bg-white/25 hover:bg-white/50'}`}
              />
            ))}
          </div>
          <button
            onClick={() => isLast ? onClose() : setSlide(v => v + 1)}
            className="px-4 py-2 rounded-lg text-white text-sm font-semibold transition-colors touch-manipulation"
            style={{ backgroundColor: s.accent }}
          >
            {isLast ? 'Commencer !' : 'Suivant →'}
          </button>
        </div>
      </div>
    </div>
  );
}
