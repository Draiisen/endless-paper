# Endless Paper

An infinite canvas drawing app built with React and Canvas 2D, where you can draw, place shapes and text, embed scenes inside scenes, and zoom endlessly in any direction. Export your work as an interactive HTML viewer with hotspot popups, camera tours, and scene navigation.

## Features

- **Infinite canvas** — pan and zoom without limits; scenes nest inside nodes for fractal-depth exploration
- **Pen tool** with pressure sensitivity, adjustable stabilizer (lazy brush), and symmetry modes (vertical, horizontal, both, radial 4/6/8)
- **Shape tools** — rectangles, circles, with fill and stroke color pickers
- **Text tool** — click to place multi-line text at any scale
- **Select tool** — drag nodes, marquee-select, group/ungroup
- **Eraser tool** — erase individual nodes by click
- **Image import** — drag-and-drop or file picker; supports vectorization
- **Layers panel** — create, reorder, toggle visibility/lock, adjust opacity
- **Asset library** — save selected nodes as reusable stamps
- **Path edit mode** (`pathedit`) — click path nodes to reveal and drag Bezier anchors
- **Hotspots** — attach click/double-click popup overlays (text bubble or modal) to any node
- **Portals** — link a node to a target scene for one-click navigation
- **Camera tour** — record viewport positions and play them back with animated transitions
- **Start camera** — set the initial view position for exported HTML viewers
- **Auto-enter / auto-exit** — zoom into a node to enter its inner scene; zoom out past 30% to exit
- **Mini-map** — overview navigation
- **Auto-save** to `localStorage` with 4 MB size guard; manual save/load to `.endless.json`
- **HTML export** with start camera, hotspot popups, camera tour play button, and scene navigation
- **Undo/Redo** history

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `P` | Pen tool |
| `V` | Select tool |
| `H` | Hand (pan) tool |
| `E` | Eraser |
| `R` | Rectangle |
| `C` | Circle |
| `T` | Text |
| `I` | Image import |
| `Z` | Enter selected node |
| `M` | Toggle mini-map |
| `Space` (hold) | Temporary pan |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save to file |
| `Ctrl+E` | Open export modal |
| `Ctrl+G` | Group selected |
| `Ctrl+Shift+G` | Ungroup |
| `Ctrl+A` | Select all |
| `Delete` / `Backspace` | Delete selected |
| `Escape` | Cancel stroke / exit scene |

## Development

```bash
npm install
npm run dev      # start dev server at http://localhost:5173
```

## Build

```bash
npm run build    # type-check + Vite production build → dist/
```

## Test

```bash
npm test         # run Vitest unit tests
```

## Tech Stack

- **React 18** + TypeScript
- **Vite 5** (build + dev server)
- **Canvas 2D API** (all rendering — no WebGL)
- **Tailwind CSS** (UI styling)
- **Vitest** (unit testing)
