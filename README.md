# Electric Plinko — developer-friendly project (clean assets)

Open `index.html` in Chrome to play. No build steps or dependencies required.

## Files
- `index.html` — page markup
- `style.css` — layout and interface styling
- `game.js` — ball simulation, drawing, results and interactions
- `assets/background.webp` — static interface background artwork
- `assets/cash_pink.png` — user-provided pink cash symbol
- `assets/free_spins_silver.png` — user-provided silver free-spins symbol (the numbers shown in game are AMD values, not counts of spins)
- `assets/lightning_clean.png` — user-provided lightning symbol

## Notes
- The background image is intentionally static artwork.
- The interactive pieces (balls, prize slot rendering, highlights, and popups) are drawn by `game.js` on the canvas.
- This is a demo only: winnings are simulated and have no cash value.
