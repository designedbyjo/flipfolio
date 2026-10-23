# Flipfolio

A browser-based PDF to flipbook converter by designedbyjo.

Upload a PDF and read it with elastic page curls, dynamic shadows, glossy covers, light and dark themes, and immersive fullscreen. PDF processing happens on your device.

## Run locally

Serve the included `dist` folder with a static web server:

```sh
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. No account, backend or API key is required. Use the demo button to try the reader without a PDF.

## Features

- PDF page 1 becomes a standalone cover, followed by paired pages in source order.
- Drag either top or bottom corners, or use arrow buttons and keyboard navigation.
- Hover previews, zoom, thumbnails, single-page mode and fullscreen.
- Download a self-contained HTML flipbook for offline reading.

## Development

`paper-flip.js` contains the custom page renderer. `dist` contains the ready-to-serve app. `vendor` contains Three.js.

Run the tests with Node.js 22 or newer:

```sh
node --test tests/*.test.mjs
```

After changing the renderer, rebuild its browser bundle:

```sh
npx esbuild paper-flip.js --bundle --format=iife --global-name=Paper --minify --outfile=dist/assets/paper-flip.browser.js
```

## Limits

This is an experimental project. Large PDFs can use substantial memory. Pages are rasterized for rendering and exported flipbooks do not preserve selectable PDF text. Rendering speed depends on your device, browser and WebGL support.

## Third-party licenses

Bundled dependencies retain their license notices in `dist/assets`: PDF.js (Apache-2.0), Three.js (MIT), StPageFlip (MIT), and bundled fonts. These notices apply to their respective third-party components.
