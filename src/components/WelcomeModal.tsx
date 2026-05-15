import { useState } from 'react';

const SLIDES = [
  {
    emoji: '✏️',
    title: 'Canvas infini',
    desc: 'Dessinez librement sans limite de taille. Pincez pour zoomer, glissez pour naviguer. Aucune grille, aucune contrainte.',
    tip: 'Choisissez un outil dans la barre de gauche',
    accent: '#6c63ff',
  },
  {
    emoji: '🌀',
    title: 'Mondes dans les mondes',
    desc: "Chaque forme peut contenir un univers entier. Double-tapez n'importe quel objet pour y entrer et créer un monde imbriqué. Dézoomez pour sortir.",
    tip: 'Double-tapez une forme → nouvelle scène',
    accent: '#22c55e',
  },
  {
    emoji: '💬',
    title: 'Rendez-le interactif',
    desc: 'Ajoutez des hotspots (info-bulles, fenêtres au tap), des portals (liens entre scènes) et des animations. Activez le mode Viewer ✎ pour explorer.',
    tip: 'Sélectionnez un objet → ⚙ Propriétés',
    accent: '#f59e0b',
  },
  {
    emoji: '⬆️',
    title: 'Exportez et partagez',
    desc: 'Exportez en HTML interactif autonome ou en SVG. Copiez un lien partageable compressé. Sauvegarde automatique dans le navigateur.',
    tip: 'Menu ⋮ → Export ou Share',
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
        <div className="flex flex-col items-center gap-4 px-8 pt-8 pb-6 text-center">
          <div className="text-6xl select-none">{s.emoji}</div>
          <h2 className="text-white text-xl font-bold">{s.title}</h2>
          <p className="text-gray-300 text-sm leading-relaxed">{s.desc}</p>
          <div className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10">
            <p className="text-xs text-gray-400">{s.tip}</p>
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
