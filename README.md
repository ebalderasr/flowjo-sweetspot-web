# flowjo-sweetspot-web

Browser-based interface for the `flowjo-sweetspot` analysis engine.

## Goal

This project is a static web app designed for GitHub Pages. It should let a user:

- upload a FlowJo-exported `csv` or `xlsx`
- define the fluorescence channel names
- choose the analysis mode
- run the sweet-spot analysis fully in the browser
- inspect plots, tables, and interpretation on screen

## Current scope

This first scaffold includes:

- static HTML/CSS/JavaScript app
- file upload for `csv`, `xlsx`, and `xls`
- editable dye-to-channel mapping
- editable selection-rule parameters
- in-browser implementation of the current sweet-spot engine
- on-screen trend plots and selection plot
- downloadable CSV exports for best conditions and full results

## Local run

You can open `index.html` directly, but a local static server is cleaner:

```bash
cd /home/ebald/github/flowjo-sweetspot-web
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

This project is intended to be deployed as a static site. A future step is to:

1. create a remote GitHub repository
2. push this folder
3. enable GitHub Pages from the repository root or `main` branch

## Next recommended steps

- split `app.js` into `engine.js`, `ui.js`, and `plots.js`
- add regression fixtures using `data.csv` from the Python repo
- support multiple worksheet selection for Excel files
- add per-dye explanatory text and richer result cards
- add export for `ws_breakdown.csv`
