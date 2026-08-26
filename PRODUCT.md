# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Thiago (owner/operator at Vale Verde Festas), planning and controlling bar costs and recipes ahead of events. Single-owner workflow today; the tool is not (yet) built for simultaneous multi-user access.

## Product Purpose

Ficha Técnica de Bar is a bar-costing and recipe-standardization tool for Vale Verde Festas, an events/festas company. It lets Thiago:

- Register **insumos** (ingredients/supplies) with supplier, purchase price, yield, correction factor, and computed unit cost, plus min/current stock.
- Build **fichas técnicas** (technical recipe sheets) for cocktails — ingredients, quantities, prep method, glassware, garnish, utensils, prep time, yield, and sale price — with automatic cost, CMV (cost of goods sold %), markup, and margin calculations.
- Record **internal productions** (batches, syrups, foams, sub-recipes) that feed into recipe costing as their own costed insumos.
- Review a **dashboard** comparing CMV and margin across recipes, plus menu-engineering classification (e.g. which drinks are high-margin/high-turnover vs. low-performers), using per-period sales volume.

Success means Thiago can price and standardize the bar menu for an event with confidence in real margins, and reprint/export a recipe as a working ficha técnica for bar staff.

## Positioning

Unlike a spreadsheet, the tool holds live-linked data: insumo costs automatically propagate through recipes and internal productions into CMV/markup/margin figures and the menu-engineering dashboard. It runs entirely client-side (SQLite compiled to WebAssembly via sql.js) with no backend — the whole dataset is a single portable `.db` file that can be exported and imported, so it travels with the business rather than living on a server.

## Operating Context

- Used before events, to plan and price the bar menu, and to keep an ingredient/supplier cost base up to date.
- Ingredient cost data originates from real purchasing records: supplier name/CNPJ, delivery windows, order status (e.g. confirmado/ruptura), and totals — see `ficha-tecnica-bar/dados/matriz_de_dados.csv` and `seed-data.js`.
- Recipe/brand development for signature cocktails happens partly in `docs/` (e.g. `clareira.md`, a signature drink for the "Florest" venue relaunch) and draws on a personal library of bartending reference books under `LIVROS/`. These are reference material feeding recipe content, not part of the app's UI.

## Capabilities and Constraints

- Static, client-side web app: plain HTML/CSS/JS, no build step, no backend/server dependency. Must stay this way.
- Data persistence is entirely local via sql.js (SQLite-in-WASM); the database is exported/imported as a `.db` file rather than synced to a server.
- UI language is Portuguese (pt-BR) and must stay Portuguese.
- Existing seed data (`matriz_de_dados.csv` / `seed-data.js`) is real operating data and must remain compatible with whatever schema the app evolves toward.
- Currently single-user; no auth/multi-user sync exists or is assumed.

## Brand Commitments

- Company: Vale Verde Festas, an events/festas (party planning) business.
- Florest is a venue/concept under the Vale Verde Festas umbrella undergoing a relaunch; "Clareira" is its signature cocktail, with a documented positioning ("o instante em que a luz atravessa a vegetação e encontra um copo" — nature, elegance, lightness, celebration; explicitly *not* dark or rustic). Treat this as binding brand evidence for any future surface that represents the Florest/Vale Verde brand world, not as a requirement for the internal costing tool's own visual design.

## Evidence on Hand

- Real supplier purchase data: `ficha-tecnica-bar/dados/matriz_de_dados.csv` (date, supplier/CNPJ, item, quantity, unit price, delivery window, order status, totals).
- Real seeded insumos/recipes: `ficha-tecnica-bar/seed-data.js`.
- Signature-cocktail brief for Florest: `docs/clareira.md`.
- Bartending reference library (recipes, technique, flavor pairing) under `LIVROS/` and mirrored notes under `docs/`.
- No customer testimonials, press, or external case studies on hand — do not fabricate any.

## Product Principles

1. Cost truth over convenience: every number the dashboard shows (CMV, markup, margin) must trace back to real, editable insumo costs — never hardcoded or estimated.
2. Stay serverless and portable: the tool's value is that it runs anywhere with no setup and travels as one file; do not introduce a backend dependency.
3. One owner, fast iteration: optimize for a single operator moving quickly through many insumos/recipes before an event, not for collaborative multi-user workflows.
4. Recipes are operational documents: a ficha técnica must be complete enough (method, yield, utensils, garnish) that bar staff can execute it without the owner present.
5. Keep the internal costing tool and the Vale Verde/Florest brand world distinct: this tool's UI does not need to carry the Florest brand identity unless a future request explicitly asks for that crossover.
