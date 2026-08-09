# Custeio de Eventos (Pacotes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Eventos" feature to the Ficha Técnica de Bar app that computes cost-per-person and CMV/margin for a package of existing per-dose fichas técnicas, so Thiago can price event packages (starting with the Florest launch).

**Architecture:** Two new SQLite tables (`eventos`, `evento_receitas`) mirroring the existing `receitas`/`receita_itens` pattern. A pure calculation function (`calcCustoEventoPessoa`) computes cost-per-person from a list of recipe costs and a doses-per-person value — testable without a live DB, same pattern already used for `computeMenuEngineering`. A new "Eventos" tab follows the exact card-list + modal-editor mechanics already used for Fichas Técnicas / Produção Interna.

**Tech Stack:** Vanilla JS (no framework, no build step), sql.js (SQLite compiled to WASM) persisted to `localStorage`, plain HTML/CSS. Tests via Node's built-in `node:test` (no dependencies).

## Global Constraints

- No build tooling — this app is loaded via plain `<script>` tags in `index.html` (see load order at the bottom of that file). Every new file must be added there in the right position if any new files are created (none are in this plan — everything goes into the four existing app files).
- Portuguese naming: SQL columns and app data are snake_case Portuguese (`preco_venda`, `doses_por_pessoa`); JS function/variable names are camelCase Portuguese (`calcCustoEvento`, `getEventos`), matching every existing function in `model.js`/`render.js`.
- No new npm dependencies. Tests run via `node --test` (already wired in `ficha-tecnica-bar/package.json`).
- Reuse existing helpers instead of duplicating logic: `run()`/`runInsert()`/`query()` (db.js) for all DB access, `setField()` (db.js) for whitelisted single-field updates, `calcIndicadores()` (model.js) for CMV/markup/margin — do not write new versions of any of these.
- Spec source of truth: `docs/superpowers/specs/2026-08-09-custeio-eventos-design.md`. If any task here seems to contradict it, the spec wins — stop and flag it rather than guessing.

---

### Task 1: Schema — `eventos` and `evento_receitas` tables

**Files:**
- Modify: `ficha-tecnica-bar/db.js:41-46` (end of `SCHEMA_SQL` template literal, right after the `producao_itens` table definition)

**Interfaces:**
- Produces: two new SQLite tables, queryable via the existing `query()`/`run()`/`runInsert()` helpers from `db.js`. `eventos` columns: `id, nome, data, convidados, horas, doses_por_pessoa, preco_pacote_pessoa, ativo`. `evento_receitas` columns: `id, evento_id, receita_id`.

`db.js` currently ends its `SCHEMA_SQL` string like this (lines 41-47):

```js
CREATE TABLE IF NOT EXISTS producao_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producao_id INTEGER NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  ingrediente_id INTEGER NOT NULL REFERENCES insumos(id),
  quantidade REAL NOT NULL DEFAULT 0
);
`;
```

- [ ] **Step 1: Add the two new `CREATE TABLE` statements**

Edit `ficha-tecnica-bar/db.js`. Find the block above and replace it with:

```js
CREATE TABLE IF NOT EXISTS producao_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producao_id INTEGER NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  ingrediente_id INTEGER NOT NULL REFERENCES insumos(id),
  quantidade REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  data TEXT DEFAULT '',
  convidados INTEGER DEFAULT 0,
  horas REAL DEFAULT 0,
  doses_por_pessoa REAL DEFAULT 0,
  preco_pacote_pessoa REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS evento_receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  receita_id INTEGER NOT NULL REFERENCES receitas(id)
);
`;
```

Note: `ON DELETE CASCADE` here is documentation of intent only — this app never runs `PRAGMA foreign_keys = ON`, so it has no runtime effect (same as the existing `receita_itens`/`producao_itens` cascades). Task 3 handles cleanup manually.

- [ ] **Step 2: Verify the tables are created on a fresh DB load**

This schema only executes inside a browser (sql.js + `localStorage`), so verification is manual, via a throwaway local server:

```bash
cd ficha-tecnica-bar
python -m http.server 8842 &
```

Then, using the `browser-harness` tool (or any browser), open `http://127.0.0.1:8842/index.html` in a **fresh** browser profile or after clearing `localStorage` for that origin (so `init()` takes the "no saved DB" path and runs `SCHEMA_SQL` fresh), and run in the page console:

```js
JSON.stringify(query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
```

Expected: the array includes `"eventos"` and `"evento_receitas"` alongside the existing `insumos`, `receitas`, `receita_itens`, `producao_itens`.

Also verify against an **existing saved DB** (don't clear `localStorage` this time, just reload): same query should still show both new tables, proving `CREATE TABLE IF NOT EXISTS` picks them up on an existing save without needing a `migrateSchema()` change.

Stop the test server when done:

```bash
netstat -ano | grep ":8842" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

- [ ] **Step 3: Commit**

```bash
git add ficha-tecnica-bar/db.js
git commit -m "Add eventos and evento_receitas tables"
```

---

### Task 2: Pure calculation function — `calcCustoEventoPessoa` (TDD)

**Files:**
- Modify: `ficha-tecnica-bar/model.js` (new function + `module.exports` at the end)
- Test: `ficha-tecnica-bar/model.test.js`

**Interfaces:**
- Produces: `calcCustoEventoPessoa(custosDasReceitas: number[], dosesPorPessoa: number): number` — pure function, no DB access. `custosDasReceitas` is a plain array of per-dose costs (e.g. `[3.12, 8.21]`), already computed by the caller via `calcCustoReceita`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

`ficha-tecnica-bar/model.test.js` currently starts like this:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcIndicadores, computeMenuEngineering, cmvClass } = require('./model.js');
```

Change the `require` line to also pull in the new function:

```js
const { calcIndicadores, computeMenuEngineering, cmvClass, calcCustoEventoPessoa } = require('./model.js');
```

Then append these tests at the end of the file:

```js
test('calcCustoEventoPessoa: lista vazia -> 0 (sem drink selecionado)', () => {
  assert.equal(calcCustoEventoPessoa([], 5), 0);
});

test('calcCustoEventoPessoa: 1 drink, 1 dose por pessoa -> custo do proprio drink', () => {
  assert.equal(calcCustoEventoPessoa([10], 1), 10);
});

test('calcCustoEventoPessoa: media simples entre varios drinks, escalada por doses/pessoa', () => {
  // media de [10, 20, 30] = 20; 20 x 3 doses/pessoa = 60
  assert.equal(calcCustoEventoPessoa([10, 20, 30], 3), 60);
});

test('calcCustoEventoPessoa: doses_por_pessoa = 0 -> 0 mesmo com drinks selecionados', () => {
  assert.equal(calcCustoEventoPessoa([10, 20], 0), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ficha-tecnica-bar
node --test
```

Expected: FAIL — `TypeError: calcCustoEventoPessoa is not a function` (it doesn't exist in `model.js` yet), and the other 7 pre-existing tests still pass.

- [ ] **Step 3: Implement the function**

In `ficha-tecnica-bar/model.js`, add a new section right before the final `module.exports` block (currently at line 265-269):

```js
// ---------- Eventos (pacotes) ----------
// Custo medio por dose entre os drinks selecionados, escalado por quantas
// doses cada convidado consome. Funcao pura - recebe os custos ja calculados
// em vez de buscar do banco, pra dar pra testar sem sql.js/localStorage.
function calcCustoEventoPessoa(custosDasReceitas, dosesPorPessoa) {
  if (!custosDasReceitas.length) return 0;
  const mediaCusto = custosDasReceitas.reduce((s, c) => s + c, 0) / custosDasReceitas.length;
  return mediaCusto * dosesPorPessoa;
}
```

Then update the `module.exports` block right after it to include the new function:

```js
// Exporta as funcoes puras pro test runner (Node). No browser `module` nao
// existe e este bloco nao roda - script tag continua funcionando igual.
if (typeof module !== 'undefined') {
  module.exports = { calcIndicadores, computeMenuEngineering, fmtMoeda, fmtPct, cmvClass, calcCustoEventoPessoa };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ficha-tecnica-bar
node --test
```

Expected: PASS — all 11 tests green (7 pre-existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add ficha-tecnica-bar/model.js ficha-tecnica-bar/model.test.js
git commit -m "Add calcCustoEventoPessoa with unit tests"
```

---

### Task 3: `model.js` — DB-backed evento functions + `deleteReceita` guard

**Files:**
- Modify: `ficha-tecnica-bar/model.js` (new functions in the "Eventos" section added in Task 2; `deleteReceita` at lines 203-209)

**Interfaces:**
- Consumes: `calcCustoEventoPessoa(custosDasReceitas, dosesPorPessoa)` from Task 2; `run`, `runInsert`, `query`, `setField` from `db.js`; `calcCustoReceita(receitaId)` from the existing "Receitas" section.
- Produces (for Tasks 5 and 6 to consume):
  - `getEventos(): Array<{id, nome, data, convidados, horas, doses_por_pessoa, preco_pacote_pessoa, ativo, custoPorPessoa}>`
  - `getEvento(id): {id, nome, ..., receitas: Array<{vinculo_id, id, nome, custo}>} | null`
  - `addEvento(): void` — inserts a blank row and calls `openEventoEditor(id)` (defined in Task 5)
  - `updateEventoField(id, field, value): void`
  - `deleteEvento(id): void` — calls `closeEventoEditor()` and `refreshAll()` (defined in Task 5)
  - `addEventoReceita(eventoId, receitaId): void`
  - `removeEventoReceita(vinculoId): void`
  - `calcCustoEvento(eventoId): number`

- [ ] **Step 1: Add the DB-backed functions**

In `ficha-tecnica-bar/model.js`, in the "Eventos (pacotes)" section added in Task 2, add these functions **after** `calcCustoEventoPessoa` and **before** the `module.exports` block:

```js
function getEventos() {
  return query('SELECT * FROM eventos ORDER BY nome').map((e) => ({ ...e, custoPorPessoa: calcCustoEvento(e.id) }));
}
function getEvento(id) {
  const e = query('SELECT * FROM eventos WHERE id = ?', [id])[0];
  if (!e) return null;
  const receitas = query(
    `SELECT er.id as vinculo_id, r.id, r.nome
     FROM evento_receitas er JOIN receitas r ON r.id = er.receita_id
     WHERE er.evento_id = ? ORDER BY r.nome`, [id]
  ).map((r) => ({ ...r, custo: calcCustoReceita(r.id) }));
  return { ...e, receitas };
}
function addEvento() {
  const id = runInsert(`INSERT INTO eventos (nome, data, convidados, horas, doses_por_pessoa, preco_pacote_pessoa, ativo)
       VALUES ('Novo evento', '', 0, 0, 0, 0, 1)`);
  openEventoEditor(id);
}
function updateEventoField(id, field, value) {
  const allowed = ['nome', 'data', 'convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa'];
  setField('eventos', allowed, id, field, value);
}
function deleteEvento(id) {
  if (!confirm('Excluir este evento?')) return;
  run('DELETE FROM evento_receitas WHERE evento_id = ?', [id]);
  run('DELETE FROM eventos WHERE id = ?', [id]);
  closeEventoEditor();
  refreshAll();
}
function addEventoReceita(eventoId, receitaId) {
  const jaExiste = query('SELECT id FROM evento_receitas WHERE evento_id = ? AND receita_id = ?', [eventoId, receitaId]).length > 0;
  if (jaExiste) return;
  run('INSERT INTO evento_receitas (evento_id, receita_id) VALUES (?, ?)', [eventoId, receitaId]);
}
function removeEventoReceita(vinculoId) {
  run('DELETE FROM evento_receitas WHERE id = ?', [vinculoId]);
}
function calcCustoEvento(eventoId) {
  const custos = query(
    `SELECT r.id FROM evento_receitas er JOIN receitas r ON r.id = er.receita_id WHERE er.evento_id = ?`,
    [eventoId]
  ).map((r) => calcCustoReceita(r.id));
  const evento = query('SELECT doses_por_pessoa FROM eventos WHERE id = ?', [eventoId])[0];
  return calcCustoEventoPessoa(custos, evento ? evento.doses_por_pessoa : 0);
}
```

`deleteEvento` and `addEvento` call `closeEventoEditor()`/`refreshAll()`/`openEventoEditor()`, which don't exist yet — that's expected here (JS function declarations hoist and these only run on click, never at load time; the existing codebase already relies on this, e.g. `getReceitas()` at line 177 calls `calcCustoReceita` which is defined later in the same file). They'll exist after Task 5.

- [ ] **Step 2: Add the usage guard to `deleteReceita`**

`ficha-tecnica-bar/model.js:203-209` currently reads:

```js
function deleteReceita(id) {
  if (!confirm('Excluir esta ficha tecnica?')) return;
  run('DELETE FROM receita_itens WHERE receita_id = ?', [id]);
  run('DELETE FROM receitas WHERE id = ?', [id]);
  closeReceitaEditor();
  refreshAll();
}
```

Replace it with (same guard pattern already used by `deleteInsumo` at lines 129-140):

```js
function deleteReceita(id) {
  const usadoEvento = query('SELECT COUNT(*) as c FROM evento_receitas WHERE receita_id = ?', [id])[0].c;
  if (usadoEvento > 0) {
    alert('Esta ficha tecnica esta sendo usada em um ou mais eventos e nao pode ser excluida. Remova-a de la primeiro.');
    return;
  }
  if (!confirm('Excluir esta ficha tecnica?')) return;
  run('DELETE FROM receita_itens WHERE receita_id = ?', [id]);
  run('DELETE FROM receitas WHERE id = ?', [id]);
  closeReceitaEditor();
  refreshAll();
}
```

- [ ] **Step 3: Verify manually in the browser**

This step needs Tasks 1, 2 and 3's code loaded together — since `index.html` doesn't have the Eventos tab/modal yet (Task 4) and nothing calls these functions from the UI yet (Task 6), verify by driving the DB layer directly from the browser console.

```bash
cd ficha-tecnica-bar
python -m http.server 8842 &
```

Open `http://127.0.0.1:8842/index.html`, wait for load, then in the page console run (one line, no line breaks, to avoid `const` redeclaration errors if you run it more than once — wrap in an IIFE):

```js
(() => {
  const receitaIds = query('SELECT id FROM receitas LIMIT 2').map(r => r.id);
  if (receitaIds.length < 2) return 'precisa de pelo menos 2 receitas cadastradas pra este teste';
  // Insere direto via runInsert em vez de chamar addEvento() - addEvento() chama
  // openEventoEditor(), que so existe a partir da Task 5.
  const eventoId = runInsert(`INSERT INTO eventos (nome, data, convidados, horas, doses_por_pessoa, preco_pacote_pessoa, ativo)
       VALUES ('Teste Task 3', '', 0, 0, 0, 0, 1)`);
  updateEventoField(eventoId, 'convidados', 100);
  updateEventoField(eventoId, 'doses_por_pessoa', 4);
  addEventoReceita(eventoId, receitaIds[0]);
  addEventoReceita(eventoId, receitaIds[0]); // duplicado de proposito - nao deve duplicar o vinculo
  addEventoReceita(eventoId, receitaIds[1]);
  const vinculos = query('SELECT * FROM evento_receitas WHERE evento_id = ?', [eventoId]);
  const custo = calcCustoEvento(eventoId);
  return JSON.stringify({ eventoId, vinculos: vinculos.length, custoPorPessoa: custo });
})();
```

Expected: `vinculos: 2` (not 3 — confirms the duplicate guard works), `custoPorPessoa` is a positive number matching `(custo da receita 1 + custo da receita 2) / 2 * 4`.

Then clean up the test row:

```js
(() => {
  const eventoId = query('SELECT id FROM eventos ORDER BY id DESC LIMIT 1')[0].id;
  run('DELETE FROM evento_receitas WHERE evento_id = ?', [eventoId]);
  run('DELETE FROM eventos WHERE id = ?', [eventoId]);
  return query('SELECT COUNT(*) c FROM eventos')[0].c;
})();
```

Also verify the `deleteReceita` guard: pick a `receitaId` currently linked to an evento (create a temporary link if needed) and confirm `deleteReceita(receitaId)` shows the alert and does **not** delete the row; then remove the link and confirm it deletes normally.

Stop the test server:

```bash
netstat -ano | grep ":8842" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

- [ ] **Step 4: Commit**

```bash
git add ficha-tecnica-bar/model.js
git commit -m "Add evento model functions and deleteReceita usage guard"
```

---

### Task 4: `index.html` + `style.css` — Eventos tab, panel, and modal markup

**Files:**
- Modify: `ficha-tecnica-bar/index.html:19-23` (tabs nav), `:65-90` (after the dashboard `<section>`, before `</main>`), `:193-195` (after the produção modal, before the `<script>` tags)
- Modify: `ficha-tecnica-bar/style.css` (append new rules)

**Interfaces:**
- Produces: DOM elements with the exact `id`s that Tasks 5 and 6 will query: `tab-eventos`, `btn-add-evento`, `eventos-list`, `modal-evento-overlay`, `modal-evento-close`, `ev-nome`, `ev-data`, `ev-convidados`, `ev-horas`, `ev-doses-por-pessoa`, `ev-preco-pacote-pessoa`, `ev-receitas-checklist`, `ev-custo-pessoa`, `ev-cmv`, `ev-markup`, `ev-margem`, `btn-delete-evento`.

- [ ] **Step 1: Add the tab button**

`ficha-tecnica-bar/index.html:19-23` currently:

```html
  <nav class="tabs">
    <button class="tab-btn active" data-tab="insumos">Insumos</button>
    <button class="tab-btn" data-tab="receitas">Fichas Técnicas</button>
    <button class="tab-btn" data-tab="dashboard">Dashboard</button>
  </nav>
```

Replace with:

```html
  <nav class="tabs">
    <button class="tab-btn active" data-tab="insumos">Insumos</button>
    <button class="tab-btn" data-tab="receitas">Fichas Técnicas</button>
    <button class="tab-btn" data-tab="dashboard">Dashboard</button>
    <button class="tab-btn" data-tab="eventos">Eventos</button>
  </nav>
```

No JS wiring needed for the click itself — `attachGlobalHandlers()` in `main.js` already binds a click handler to every `.tab-btn` generically, and `renderTabs()` already toggles `.active` by matching `data-tab` to the panel `id="tab-${state.tab}"`. Both already work for any new tab without changes.

- [ ] **Step 2: Add the tab panel**

`ficha-tecnica-bar/index.html:65-90` currently ends the dashboard section and closes `<main>`:

```html
    <section id="tab-dashboard" class="tab-panel">
      <div class="toolbar">
        <span>Comparativo de CMV e margem por receita</span>
        <span id="dashboard-total" class="muted"></span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Receita</th>
              <th>Custo</th>
              <th>Preço de venda</th>
              <th>CMV</th>
              <th>Markup</th>
              <th>Margem</th>
              <th>Vendas período</th>
            </tr>
          </thead>
          <tbody id="dashboard-tbody"></tbody>
        </table>
      </div>

      <h3>Engenharia de cardápio</h3>
      <div id="menu-engineering"></div>
    </section>
  </main>
```

Add a new `<section>` right after `</section>` (dashboard's closing tag) and before `</main>`:

```html
    <section id="tab-eventos" class="tab-panel">
      <div class="toolbar">
        <span class="muted">Pacotes de evento (custo e preço por pessoa)</span>
        <button id="btn-add-evento" class="btn">+ Novo evento</button>
      </div>
      <div id="eventos-list" class="receitas-grid"></div>
    </section>
  </main>
```

- [ ] **Step 3: Add the modal**

`ficha-tecnica-bar/index.html:145-195` currently has the produção-interna modal ending like this, right before the `<script>` tags:

```html
      <div class="modal-footer">
        <button id="btn-delete-producao" class="btn danger">Excluir produção interna</button>
      </div>
    </div>
  </div>

  <script src="lib/sql-wasm.js"></script>
```

Insert a new modal between the closing `</div>` of `modal-producao-overlay` and the `<script>` tags:

```html
      <div class="modal-footer">
        <button id="btn-delete-producao" class="btn danger">Excluir produção interna</button>
      </div>
    </div>
  </div>

  <div id="modal-evento-overlay" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <input id="ev-nome" type="text" class="modal-title-input" placeholder="Nome do evento">
        <button id="modal-evento-close" class="icon-btn">✕</button>
      </div>

      <div class="modal-body">
        <div class="form-grid">
          <label>Data <input id="ev-data" type="date"></label>
          <label>Convidados <input id="ev-convidados" type="number" step="1"></label>
          <label>Duração (horas) <input id="ev-horas" type="number" step="0.5"></label>
          <label>Doses por pessoa <input id="ev-doses-por-pessoa" type="number" step="0.5"></label>
          <label>Preço do pacote por pessoa <input id="ev-preco-pacote-pessoa" type="number" step="0.01"></label>
        </div>

        <h3>Drinks do pacote</h3>
        <div id="ev-receitas-checklist" class="checklist"></div>

        <div class="indicadores">
          <div class="indicador"><span>Custo/pessoa</span><strong id="ev-custo-pessoa">R$ 0,00</strong></div>
          <div class="indicador"><span>CMV</span><strong id="ev-cmv" class="badge">-</strong></div>
          <div class="indicador"><span>Markup</span><strong id="ev-markup">-</strong></div>
          <div class="indicador"><span>Margem/pessoa</span><strong id="ev-margem">R$ 0,00</strong></div>
        </div>
      </div>

      <div class="modal-footer">
        <button id="btn-delete-evento" class="btn danger">Excluir evento</button>
      </div>
    </div>
  </div>

  <script src="lib/sql-wasm.js"></script>
```

- [ ] **Step 4: Add CSS for the checklist**

`ficha-tecnica-bar/style.css` ends (lines 241-245) with the `.me-abacaxi` rule. Append at the end of the file:

```css

.checklist {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
}
.checklist-item {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 13px;
  color: var(--text);
  border-bottom: 1px dashed var(--border);
}
.checklist-item:last-child { border-bottom: none; }
.checklist-item input[type="checkbox"] { margin-right: 6px; }
```

Note: the global `label { flex-direction: column; ... }` rule (line 195) would stack the checkbox above the text by default — `.checklist-item` overrides with `flex-direction: row` explicitly so each row reads as `[checkbox] Nome ... custo`.

- [ ] **Step 5: Verify the tab and modal render with no console errors**

```bash
cd ficha-tecnica-bar
python -m http.server 8842 &
```

Open `http://127.0.0.1:8842/index.html`. Click the "Eventos" tab — confirm the panel shows the "+ Novo evento" button and an empty `eventos-list` div, with no JS errors in the console (the `+ Novo evento` button won't do anything yet — that's Task 6 — but it must not error on click since `addEvento` already exists from Task 3; clicking is optional here, just confirm the page loads and the tab switches cleanly).

Stop the test server:

```bash
netstat -ano | grep ":8842" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

- [ ] **Step 6: Commit**

```bash
git add ficha-tecnica-bar/index.html ficha-tecnica-bar/style.css
git commit -m "Add Eventos tab, panel, and modal markup"
```

---

### Task 5: `render.js` — `renderEventos`, editor render functions, wire into `refreshAll`

**Files:**
- Modify: `ficha-tecnica-bar/render.js:9-15` (`refreshAll`), and add new functions after `renderMenuEngineering` (currently ending at line 143) and after `renderReceitaEditor`'s section (currently ending at line 255)

**Interfaces:**
- Consumes: `getEventos()`, `getEvento(id)`, `calcCustoEventoPessoa()`, `addEventoReceita()`, `removeEventoReceita()` from Task 3; `getReceitas()`, `calcIndicadores()`, `fmtMoeda()`, `fmtPct()`, `cmvClass()`, `escapeHtml()` (existing); `state.editingEventoId` (added in Task 6).
- Produces: `renderEventos(): void`, `openEventoEditor(id): void`, `closeEventoEditor(): void`, `renderEventoEditor(): void` — the last three are what `addEvento`/`deleteEvento` (Task 3) and `main.js` (Task 6) call.

- [ ] **Step 1: Wire `renderEventos` into `refreshAll`**

`ficha-tecnica-bar/render.js:9-15` currently:

```js
function refreshAll() {
  renderInsumos();
  renderReceitas();
  renderDashboard();
  if (state.editingReceitaId) renderReceitaEditor();
  if (state.editingProducaoId) renderProducaoEditor();
}
```

Replace with:

```js
function refreshAll() {
  renderInsumos();
  renderReceitas();
  renderDashboard();
  renderEventos();
  if (state.editingReceitaId) renderReceitaEditor();
  if (state.editingProducaoId) renderProducaoEditor();
  if (state.editingEventoId) renderEventoEditor();
}
```

- [ ] **Step 2: Add `renderEventos`**

Add this function right after `renderMenuEngineering` (which currently ends at line 143, right before the `renderItemsTable` comment block):

```js
function renderEventos() {
  const eventos = getEventos();
  const list = document.getElementById('eventos-list');
  list.innerHTML = eventos.map((e) => {
    const { cmv } = calcIndicadores(e.custoPorPessoa, e.preco_pacote_pessoa);
    return `
      <div class="receita-card" onclick="openEventoEditor(${e.id})">
        <div class="receita-card-title">${escapeHtml(e.nome)}</div>
        <div class="receita-card-row"><span>Convidados</span><strong>${e.convidados}</strong></div>
        <div class="receita-card-row"><span>Custo/pessoa</span><strong>${fmtMoeda(e.custoPorPessoa)}</strong></div>
        <div class="receita-card-row"><span>CMV</span><strong class="badge ${cmvClass(cmv)}">${fmtPct(cmv)}</strong></div>
      </div>
    `;
  }).join('') || '<p class="muted">Nenhum evento cadastrado ainda.</p>';
}
```

- [ ] **Step 3: Add the evento editor functions**

Add this section right after `renderReceitaEditor` (which currently ends at line 255, right before the `updateUnidadeAviso` comment block):

```js
// ---------- Editor de evento (modal) ----------
function openEventoEditor(id) {
  state.editingEventoId = id;
  document.getElementById('modal-evento-overlay').classList.add('active');
  renderEventoEditor();
}
function closeEventoEditor() {
  state.editingEventoId = null;
  document.getElementById('modal-evento-overlay').classList.remove('active');
}
function renderEventoEditor() {
  const ev = getEvento(state.editingEventoId);
  if (!ev) return;

  document.getElementById('ev-nome').value = ev.nome;
  document.getElementById('ev-data').value = ev.data || '';
  document.getElementById('ev-convidados').value = ev.convidados;
  document.getElementById('ev-horas').value = ev.horas;
  document.getElementById('ev-doses-por-pessoa').value = ev.doses_por_pessoa;
  document.getElementById('ev-preco-pacote-pessoa').value = ev.preco_pacote_pessoa;

  const todasReceitas = getReceitas();
  const selecionadasIds = new Set(ev.receitas.map((r) => r.id));
  const checklist = document.getElementById('ev-receitas-checklist');
  checklist.innerHTML = todasReceitas.map((r) => `
    <label class="checklist-item">
      <span><input type="checkbox" data-receita-id="${r.id}" ${selecionadasIds.has(r.id) ? 'checked' : ''}> ${escapeHtml(r.nome)}</span>
      <span class="muted">${fmtMoeda(r.custo)}</span>
    </label>
  `).join('') || '<p class="muted">Nenhuma ficha tecnica cadastrada ainda.</p>';

  checklist.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const receitaId = Number(e.target.dataset.receitaId);
      if (e.target.checked) {
        addEventoReceita(ev.id, receitaId);
      } else {
        const vinculo = ev.receitas.find((r) => r.id === receitaId);
        if (vinculo) removeEventoReceita(vinculo.vinculo_id);
      }
      refreshAll();
    });
  });

  const custosSelecionados = ev.receitas.map((r) => r.custo);
  const custoPorPessoa = calcCustoEventoPessoa(custosSelecionados, ev.doses_por_pessoa);
  const { cmv, markup, margem } = calcIndicadores(custoPorPessoa, ev.preco_pacote_pessoa);

  document.getElementById('ev-custo-pessoa').textContent = ev.receitas.length
    ? fmtMoeda(custoPorPessoa)
    : 'Selecione ao menos 1 drink';
  const cmvEl = document.getElementById('ev-cmv');
  cmvEl.textContent = fmtPct(cmv);
  cmvEl.className = 'badge ' + cmvClass(cmv);
  document.getElementById('ev-markup').textContent = markup ? markup.toFixed(2) + 'x' : '-';
  document.getElementById('ev-margem').textContent = fmtMoeda(margem);
}
```

- [ ] **Step 4: Verify manually in the browser**

```bash
cd ficha-tecnica-bar
python -m http.server 8842 &
```

Open `http://127.0.0.1:8842/index.html`, click the Eventos tab (should now show "Nenhum evento cadastrado ainda."), then in the console:

```js
addEvento();
```

Expected: the evento modal opens (since `openEventoEditor` now exists), title input is empty/default, checklist shows every cadastrada ficha técnica unchecked, "Custo/pessoa" shows "Selecione ao menos 1 drink". Check one checkbox in the UI — confirm "Custo/pessoa" and "CMV" update immediately without reloading. Close the modal (✕) and confirm a new card appears in `eventos-list`.

Clean up the test row from the console:

```js
(() => {
  const eventoId = query('SELECT id FROM eventos ORDER BY id DESC LIMIT 1')[0].id;
  run('DELETE FROM evento_receitas WHERE evento_id = ?', [eventoId]);
  run('DELETE FROM eventos WHERE id = ?', [eventoId]);
  refreshAll();
})();
```

Stop the test server:

```bash
netstat -ano | grep ":8842" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

- [ ] **Step 5: Commit**

```bash
git add ficha-tecnica-bar/render.js
git commit -m "Add evento rendering: card list and editor modal"
```

---

### Task 6: `main.js` — wire buttons, form fields, and checklist; final end-to-end verification

**Files:**
- Modify: `ficha-tecnica-bar/main.js:3-8` (`state`), and inside `attachGlobalHandlers()` (currently lines 50-113)

**Interfaces:**
- Consumes: everything from Tasks 3 and 5 (`addEvento`, `deleteEvento`, `updateEventoField`, `openEventoEditor`/`closeEventoEditor`/`renderEventoEditor`, `bindFormFields` helper already defined in `main.js:20-30`).
- Produces: a fully clickable "Eventos" tab — this is the last task, nothing downstream depends on it.

- [ ] **Step 1: Add `editingEventoId` to `state`**

`ficha-tecnica-bar/main.js:3-8` currently:

```js
let state = {
  tab: 'insumos',
  insumoFiltro: '',
  editingReceitaId: null,
  editingProducaoId: null,
};
```

Replace with:

```js
let state = {
  tab: 'insumos',
  insumoFiltro: '',
  editingReceitaId: null,
  editingProducaoId: null,
  editingEventoId: null,
};
```

- [ ] **Step 2: Wire the "+ Novo evento" button and the modal close/overlay/delete handlers**

`ficha-tecnica-bar/main.js` currently has this block (around lines 79-90):

```js
  document.getElementById('modal-producao-close').addEventListener('click', () => { closeProducaoEditor(); refreshAll(); });
  document.getElementById('modal-producao-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-producao-overlay') { closeProducaoEditor(); refreshAll(); }
  });
  document.getElementById('btn-delete-producao').addEventListener('click', () => {
    const id = state.editingProducaoId;
    deleteInsumo(id);
    if (!query('SELECT id FROM insumos WHERE id = ?', [id]).length) {
      closeProducaoEditor();
      refreshAll();
    }
  });
```

Add the following right after that block (still inside `attachGlobalHandlers()`, before the closing `}`):

```js
  document.getElementById('btn-add-evento').addEventListener('click', addEvento);
  document.getElementById('modal-evento-close').addEventListener('click', () => { closeEventoEditor(); refreshAll(); });
  document.getElementById('modal-evento-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-evento-overlay') { closeEventoEditor(); refreshAll(); }
  });
  document.getElementById('btn-delete-evento').addEventListener('click', () => deleteEvento(state.editingEventoId));
```

- [ ] **Step 3: Wire the evento form fields**

`ficha-tecnica-bar/main.js` currently ends `attachGlobalHandlers()` with the produção-interna `bindFormFields` call (around lines 105-112):

```js
  bindFormFields(
    ['pr-nome', 'pr-categoria', 'pr-unidade', 'pr-rendimento', 'pr-fator'],
    { 'pr-nome': 'nome', 'pr-categoria': 'categoria', 'pr-unidade': 'unidade_compra', 'pr-rendimento': 'tamanho_unidade', 'pr-fator': 'fator_correcao' },
    ['tamanho_unidade', 'fator_correcao'],
    () => state.editingProducaoId,
    updateInsumoField
  );
  bindAddItemRow('btn-add-pritem', 'pr-add-insumo', 'pr-add-qtd', 'pr-add-unidade', () => state.editingProducaoId, addProducaoItem);
}
```

Add this right after the `bindAddItemRow(...)` call and before the closing `}` of `attachGlobalHandlers()`:

```js

  bindFormFields(
    ['ev-nome', 'ev-data', 'ev-convidados', 'ev-horas', 'ev-doses-por-pessoa', 'ev-preco-pacote-pessoa'],
    {
      'ev-nome': 'nome', 'ev-data': 'data', 'ev-convidados': 'convidados', 'ev-horas': 'horas',
      'ev-doses-por-pessoa': 'doses_por_pessoa', 'ev-preco-pacote-pessoa': 'preco_pacote_pessoa',
    },
    ['convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa'],
    () => state.editingEventoId,
    updateEventoField
  );
}
```

This reuses `bindFormFields`, the same generic helper already used for the receita and produção forms (defined earlier in `main.js:20-30`) — no new binding logic needed. There's no "add item row" call for events because drinks are toggled via the checklist checkboxes (wired directly in `renderEventoEditor` in Task 5), not an add-by-select-and-button row like recipe/production ingredients.

- [ ] **Step 4: Full end-to-end manual verification**

```bash
cd ficha-tecnica-bar
python -m http.server 8842 &
```

Open `http://127.0.0.1:8842/index.html` and, driving the actual UI (click, type — not console shortcuts) or via `browser-harness`:

1. Click the "Eventos" tab.
2. Click "+ Novo evento". Modal opens.
3. Set nome to "Teste Florest", convidados to `300`, horas to `5`, doses por pessoa to `4`.
4. Check 2-3 fichas técnicas in the checklist. Confirm "Custo/pessoa" updates live to a real number (not "Selecione ao menos 1 drink", not `NaN`).
5. Set "Preço do pacote por pessoa" to a number bigger than the shown cost (e.g. if custo/pessoa shows R$ 20,00, type `60`). Confirm CMV badge turns green/appropriate color and shows a percentage, markup shows an "x" value, margem shows a positive value.
6. Uncheck one drink. Confirm the numbers recompute live.
7. Close the modal (✕). Confirm the card appears in the Eventos tab list with matching custo/pessoa and CMV.
8. Reload the page (`F5` / navigate to the same URL again). Click Eventos tab. Confirm the "Teste Florest" card is still there with the same numbers — proves persistence survived a reload.
9. Reopen the card, click "Excluir evento", confirm the browser `confirm()` dialog, confirm the card disappears from the list.
10. Reload again, confirm it's gone for good (not just removed from the in-memory render).

If any step fails, fix the relevant task before continuing — do not proceed to commit with a broken flow.

Stop the test server:

```bash
netstat -ano | grep ":8842" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

- [ ] **Step 5: Run the full unit test suite one more time**

```bash
cd ficha-tecnica-bar
node --test
```

Expected: all 11 tests still pass (nothing in this task touches `model.js`, but this is the last checkpoint before shipping).

- [ ] **Step 6: Commit**

```bash
git add ficha-tecnica-bar/main.js
git commit -m "Wire Eventos tab buttons, form fields, and checklist"
```

---

## Post-plan note

This plan builds the feature described in the spec exactly as scoped — it does **not** include: weighting by `vendas_periodo` history, automatic price suggestion by target CMV, or deriving `doses_por_pessoa` from `horas` — all explicitly out of scope per the spec's "Fora de escopo" section. Do not add them without a new spec.
