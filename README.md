# Turbo Kart 8

A Mario Kart 8-style 3D arcade kart racer built with **TypeScript**, **Vite**, **Three.js**, and **Web Audio** — designed to run right in any browser on **GitHub Pages** with zero downloads.

## Features

- **8 Detailed Themed Tracks (2 Cups × 4 Tracks)** with varied corner geometry, elevation hills, bridges/overpasses, boost pads, jump & glider ramps, moving hazards, and **16 functional shortcuts** (2 per track).
  - **Mushroom Cup**: *Sunburst Circuit*, *Toadstool Harbor*, *Frostbite Glacier*, *Ember Citadel*
  - **Star Cup**: *Neon Metropolis*, *Sakura Canyon*, *Sandstone Oasis*, *Starlight Rainbow Road*
- **8 Playable Drivers, 8 Multi-Part Kart Chassis & 4 Wheel Sets** previewable in an interactive 3D rotating garage with 6 stat bars.
- **4 Bot Difficulty Tiers** (`50cc Easy`, `100cc Medium`, `150cc Hard`, `200cc Master`) featuring apex-hugging lines, 3-tier mini-turbo drifting, shortcut routing, hazard dodging, and defensive item play.
- **11 Position-Weighted + RNG Items**: Coin, Banana, Green Shell, Triple Green Shells, Red Shell, Dash Mushroom, Triple Mushrooms, Bob-omb, Super Star, Spiny Shell, and Lightning Bolt.
- **5 Live-Switchable Graphics Presets + Custom Sliders**: From **Potato (10-Gen Old CPU)** (`0.45x` pixelated rendering, unlit basic shaders, zero shadows, minimal scenery, 30 FPS cap) up to **Ultra (Current-Gen GPU)** (ACES Filmic HDR, clearcoat + environment reflections, `4096×4096` soft shadows, bloom, speed FX, and dynamic lights).

## Controls (Keyboard & Mouse)

| Action | Key / Button |
| :--- | :--- |
| Accelerate / Brake & Reverse | `W` / `S` or `↑` / `↓` |
| Steer | `A` / `D` or `←` / `→` |
| Hop / Drift / Air Trick | `Space` or `Left Shift` |
| Use / Hold-Trail Item | `E`, `F`, `X`, `Right Shift`, or `Left Click` |
| Rear-View Camera | `Q`, `C`, or `Right Click` |
| Pause & Live Settings | `Esc` or `P` |

## Local Development

```bash
npm install
npm run dev        # Start local dev server
npm run typecheck  # Verify TypeScript types
npm run build      # Build production site into dist/
npm run preview    # Preview built site locally
```

## Publish on GitHub Pages (Playable in Browser)

1. Create an empty GitHub repository (do not add a README/license if pushing this existing repo).
2. Push this repository to `main`:
   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. In your GitHub repository go to **Settings → Pages**, set **Source** to **GitHub Actions**, and wait ~1 minute for `.github/workflows/deploy.yml` to deploy your playable browser URL.
