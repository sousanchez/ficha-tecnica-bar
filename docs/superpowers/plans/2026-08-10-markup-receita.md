# Markup Alvo + Salvar Explícito na Ficha Técnica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Markup alvo" field to the ficha técnica (recipe) editor that computes a suggested sale price, and convert the whole recipe editor from autosave-per-field to an in-memory draft with an explicit "Salvar" button.

**Architecture:** A `state.receitaDraft` object holds all in-progress edits (scalar fields + insumo items) for the recipe currently open in the modal. Nothing touches the database until "Salvar" reconciles the draft against `receita_itens`/`receitas` using existing model.js functions. Rendering splits into a "populate fields" pass (runs only on open/after-save) and a "recompute derived values" pass (runs on every draft edit) to avoid resetting input cursor position while typing.

**Tech Stack:** Vanilla JS (no framework, no build step), sql.js (SQLite-in-WASM) persisted to `localStorage`, plain HTML/CSS. Tests via Node's built-in `node:test`.

## Global Constraints

- No build tooling — plain `<script>` tags in `index.html`, load order at the bottom of that file. No new files are added by this plan; all changes go into the existing four app files plus tests.
- Portuguese naming: SQL columns snake_case Portuguese (`markup_alvo`), JS functions/variables camelCase Portuguese (`calcPrecoSugerido`, `abrirRascunhoDaReceita`), matching every existing function in the codebase.
- No new npm dependencies.
- Reuse existing helpers instead of duplicating logic: `run()`/`runInsert()`/`query()` (db.js), `setField()` (db.js), `calcIndicadores()` (model.js), `renderItemsTable()` / `updateUnidadeAviso()` (render.js), `bindFormFields()` (main.js, stays used by produção/evento editors — do not delete it).
- Scope is the ficha técnica (receita) editor only. Insumo, produção interna, and evento editors keep their current autosave behavior — do not touch `bindFormFields`, `bindAddItemRow`, `renderProducaoEditor`, or any evento code.
- Spec source of truth: `docs/superpowers/specs/2026-08-10-markup-receita-design.md`. If a task here seems to contradict it, the spec wins — stop and flag it rather than guessing.

---

### Task 1: Schema — `markup_alvo` column + `addReceita`/`updateReceitaField`

**Files:**
- Modify: `ficha-tecnica-bar/db.js:21-34` (`SCHEMA_SQL`, table `receitas`)
- Modify: `ficha-tecnica-bar/db.js:86-99` (`migrateSchema`)
- Modify: `ficha-tecnica-bar/model.js:198-201` (`addReceita`)
- Modify: `ficha-tecnica-bar/model.js:215-218` (`updateReceitaField`)

**Interfaces:**
- Produces: `receitas.markup_alvo` column (REAL, default 0), readable via the existing `getReceita`/`getReceitas` (`SELECT *`) with no code change needed there. `updateReceitaField(id, 'markup_alvo', value)` now accepted (used by Task 6's `salvarReceita`, not by any autosave binding).

- [ ] **Step 1: Add the column to `SCHEMA_SQL`**

`ficha-tecnica-bar/db.js:21-34` currently:

```js
CREATE TABLE IF NOT EXISTS receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT DEFAULT '',
  modo_preparo TEXT DEFAULT '',
  copo TEXT DEFAULT '',
  guarnicao TEXT DEFAULT '',
  preco_venda REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1,
  utensilios TEXT DEFAULT '',
  tempo_preparo TEXT DEFAULT '',
  rendimento TEXT DEFAULT '',
  vendas_periodo REAL DEFAULT 0
);
```

Replace with:

```js
CREATE TABLE IF NOT EXISTS receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT DEFAULT '',
  modo_preparo TEXT DEFAULT '',
  copo TEXT DEFAULT '',
  guarnicao TEXT DEFAULT '',
  preco_venda REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1,
  utensilios TEXT DEFAULT '',
  tempo_preparo TEXT DEFAULT '',
  rendimento TEXT DEFAULT '',
  vendas_periodo REAL DEFAULT 0,
  markup_alvo REAL DEFAULT 0
);
```

- [ ] **Step 2: Add the migration for existing saved databases**

`ficha-tecnica-bar/db.js:96` currently has, inside `migrateSchema`:

```js
  addColIfMissing('receitas', 'vendas_periodo REAL DEFAULT 0');
```

Add right after it:

```js
  addColIfMissing('receitas', 'vendas_periodo REAL DEFAULT 0');
  addColIfMissing('receitas', 'markup_alvo REAL DEFAULT 0');
```

- [ ] **Step 3: Add the column to `addReceita`'s INSERT**

`ficha-tecnica-bar/model.js:198-201` currently:

```js
function addReceita() {
  const id = runInsert(`INSERT INTO receitas (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo)
       VALUES ('Nova receita', '', '', '', '', 0, 1, '', '', '', 0)`);
  openReceitaEditor(id);
}
```

Replace with:

```js
function addReceita() {
  const id = runInsert(`INSERT INTO receitas (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo)
       VALUES ('Nova receita', '', '', '', '', 0, 1, '', '', '', 0, 0)`);
  openReceitaEditor(id);
}
```

- [ ] **Step 4: Add `markup_alvo` to `updateReceitaField`'s whitelist**

`ficha-tecnica-bar/model.js:215-218` currently:

```js
function updateReceitaField(id, field, value) {
  const allowed = ['nome', 'categoria', 'modo_preparo', 'copo', 'guarnicao', 'preco_venda', 'utensilios', 'tempo_preparo', 'rendimento', 'vendas_periodo'];
  setField('receitas', allowed, id, field, value);
}
```

Replace with:

```js
function updateReceitaField(id, field, value) {
  const allowed = ['nome', 'categoria', 'modo_preparo', 'copo', 'guarnicao', 'preco_venda', 'utensilios', 'tempo_preparo', 'rendimento', 'vendas_periodo', 'markup_alvo'];
  setField('receitas', allowed, id, field, value);
}
```

- [ ] **Step 5: Verify with the Node/sql.js schema check (no browser needed)**

This app only runs in a browser, but schema correctness can be verified headlessly with sql.js directly under Node (same technique used to verify the previous Eventos feature, since `browser-harness` may be unavailable in this environment):

```bash
node -e "
const fs = require('fs');
const initSqlJs = require('./ficha-tecnica-bar/lib/sql-wasm.js');
const src = fs.readFileSync('./ficha-tecnica-bar/db.js', 'utf8');
const schemaSql = src.match(/const SCHEMA_SQL = \`([\s\S]*?)\`;/)[1];
initSqlJs({ locateFile: (f) => './ficha-tecnica-bar/lib/' + f }).then((SQL) => {
  const db = new SQL.Database();
  db.run(schemaSql);
  const cols = db.exec('PRAGMA table_info(receitas)')[0].values.map(r => r[1]);
  console.log('colunas de receitas:', cols);
  if (!cols.includes('markup_alvo')) { console.error('FALHA: markup_alvo ausente'); process.exit(1); }
  console.log('OK');
});
"
```

Expected: `colunas de receitas:` lists `markup_alvo` among the others, then `OK`.

- [ ] **Step 6: Commit**

```bash
git add ficha-tecnica-bar/db.js ficha-tecnica-bar/model.js
git commit -m "Add markup_alvo column to receitas"
```

---

### Task 2: Pure functions — `calcPrecoSugerido` and `calcCustoDraftItens` (TDD)

**Files:**
- Modify: `ficha-tecnica-bar/model.js` (new functions + `module.exports`)
- Test: `ficha-tecnica-bar/model.test.js`

**Interfaces:**
- Produces: `calcPrecoSugerido(custo: number, markupAlvo: number): number` — pure, `custo * markupAlvo`.
- Produces: `calcCustoDraftItens(itens: Array<{quantidade: number, preco_unitario: number}>): number` — pure, sums `quantidade * preco_unitario` across the array. Used by Task 4's render logic and Task 5's "Aplicar" button handler to compute cost from `state.receitaDraft.itens` without a DB round-trip.

- [ ] **Step 1: Write the failing tests**

`ficha-tecnica-bar/model.test.js` currently ends with the `calcCustoEventoPessoa` tests. Append at the end of the file:

```js
test('calcPrecoSugerido: custo x markup normal', () => {
  assert.equal(calcPrecoSugerido(10, 3), 30);
});

test('calcPrecoSugerido: custo 0 -> 0', () => {
  assert.equal(calcPrecoSugerido(0, 5), 0);
});

test('calcPrecoSugerido: markup 0 -> 0', () => {
  assert.equal(calcPrecoSugerido(10, 0), 0);
});

test('calcPrecoSugerido: markup negativo -> sem trava, resultado negativo', () => {
  assert.equal(calcPrecoSugerido(10, -1), -10);
});

test('calcCustoDraftItens: lista vazia -> 0', () => {
  assert.equal(calcCustoDraftItens([]), 0);
});

test('calcCustoDraftItens: soma quantidade x preco_unitario de cada item', () => {
  const itens = [
    { quantidade: 30, preco_unitario: 0.05 },
    { quantidade: 10, preco_unitario: 0.2 },
  ];
  // 30*0.05 + 10*0.2 = 1.5 + 2 = 3.5
  assert.equal(calcCustoDraftItens(itens), 3.5);
});
```

Update the `require` line at the top of `ficha-tecnica-bar/model.test.js` (currently `const { calcIndicadores, computeMenuEngineering, cmvClass, calcCustoEventoPessoa } = require('./model.js');`) to also pull in the two new functions:

```js
const { calcIndicadores, computeMenuEngineering, cmvClass, calcCustoEventoPessoa, calcPrecoSugerido, calcCustoDraftItens } = require('./model.js');
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ficha-tecnica-bar
node --test
```

Expected: FAIL — `TypeError: calcPrecoSugerido is not a function` (and same for `calcCustoDraftItens`), other pre-existing tests still pass.

- [ ] **Step 3: Implement the functions**

In `ficha-tecnica-bar/model.js`, in the "Eventos (pacotes)" section, find the `module.exports` block at the end of the file:

```js
if (typeof module !== 'undefined') {
  module.exports = { calcIndicadores, computeMenuEngineering, fmtMoeda, fmtPct, cmvClass, calcCustoEventoPessoa };
}
```

Replace it with the two new functions plus the updated export list:

```js
// ---------- Ficha tecnica: markup alvo e preco sugerido ----------
function calcPrecoSugerido(custo, markupAlvo) {
  return custo * markupAlvo;
}
function calcCustoDraftItens(itens) {
  return itens.reduce((sum, it) => sum + it.quantidade * it.preco_unitario, 0);
}

// Exporta as funcoes puras pro test runner (Node). No browser `module` nao
// existe e este bloco nao roda - script tag continua funcionando igual.
if (typeof module !== 'undefined') {
  module.exports = { calcIndicadores, computeMenuEngineering, fmtMoeda, fmtPct, cmvClass, calcCustoEventoPessoa, calcPrecoSugerido, calcCustoDraftItens };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ficha-tecnica-bar
node --test
```

Expected: PASS — all tests green (11 pre-existing + 6 new = 17).

- [ ] **Step 5: Commit**

```bash
git add ficha-tecnica-bar/model.js ficha-tecnica-bar/model.test.js
git commit -m "Add calcPrecoSugerido and calcCustoDraftItens with unit tests"
```

---

### Task 3: `index.html` + `style.css` — markup field, suggested-price row, Salvar button

**Files:**
- Modify: `ficha-tecnica-bar/index.html:113` (form-grid, receita modal)
- Modify: `ficha-tecnica-bar/index.html:118-121` (between form-grid and "Modo de preparo")
- Modify: `ficha-tecnica-bar/index.html` (receita modal's `modal-footer`, currently holds "Imprimir ficha técnica" and "Excluir ficha técnica" buttons)
- Modify: `ficha-tecnica-bar/style.css` (append)

**Interfaces:**
- Produces: DOM elements `re-markup-alvo`, `re-preco-sugerido`, `btn-aplicar-preco-sugerido`, `btn-salvar-receita` — these are what Task 4 (render.js) and Task 5 (main.js) will query. The app keeps working exactly as it does today after this task — nothing references these new elements yet, so there is no functional change, only new inert markup.

- [ ] **Step 1: Add the "Markup alvo" field**

`ficha-tecnica-bar/index.html:113` currently:

```html
          <label>Preço de venda <input id="re-preco-venda" type="number" step="0.01"></label>
```

Replace with:

```html
          <label>Preço de venda <input id="re-preco-venda" type="number" step="0.01"></label>
          <label>Markup alvo <input id="re-markup-alvo" type="number" step="0.5" placeholder="Ex: 3.5"></label>
```

- [ ] **Step 2: Add the "Preço sugerido" row**

`ficha-tecnica-bar/index.html:118-121` currently:

```html
        </div>
        <label class="full">Modo de preparo
          <textarea id="re-modo-preparo" rows="3" placeholder="Descreva o preparo..."></textarea>
        </label>
```

Replace with:

```html
        </div>
        <div class="sugestao-preco">
          Preço sugerido: <strong id="re-preco-sugerido">R$ 0,00</strong>
          <button id="btn-aplicar-preco-sugerido" class="btn secondary">Aplicar</button>
        </div>
        <label class="full">Modo de preparo
          <textarea id="re-modo-preparo" rows="3" placeholder="Descreva o preparo..."></textarea>
        </label>
```

- [ ] **Step 3: Add the "Salvar" button**

Find the receita modal's footer in `ficha-tecnica-bar/index.html` (currently):

```html
      <div class="modal-footer">
        <button id="btn-print-receita" class="btn secondary">Imprimir ficha técnica</button>
        <button id="btn-delete-receita" class="btn danger">Excluir ficha técnica</button>
      </div>
```

Replace with:

```html
      <div class="modal-footer">
        <button id="btn-salvar-receita" class="btn">Salvar</button>
        <button id="btn-print-receita" class="btn secondary">Imprimir ficha técnica</button>
        <button id="btn-delete-receita" class="btn danger">Excluir ficha técnica</button>
      </div>
```

There are two `modal-footer` divs in the file (receita and produção interna) — make sure to edit the one inside `modal-overlay` (the receita modal), not `modal-producao-overlay`. The receita modal's footer is the first one in the file (it contains `btn-print-receita`/`btn-delete-receita`; the produção one contains `btn-delete-producao` only).

- [ ] **Step 4: Add CSS for the suggested-price row**

`ficha-tecnica-bar/style.css` ends with the `.checklist-item input[type="checkbox"]` rule (added by the Eventos feature). Append at the end of the file:

```css

.sugestao-preco {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 16px;
  font-size: 13px;
  color: var(--muted);
}
.sugestao-preco strong { color: var(--text); }
```

- [ ] **Step 5: Verify the new elements exist and the app still loads cleanly**

```bash
node --check ficha-tecnica-bar/render.js
node --check ficha-tecnica-bar/main.js
```

(Confirms Task 3's HTML changes did not accidentally get JS mixed in and everything still parses — HTML itself has no syntax checker here, but nothing in this task touches `.js` files, so this is a smoke check that neighboring files are untouched.)

Then confirm the new ids exist exactly once, using `grep`/`Grep`:

```bash
grep -c 're-markup-alvo\|re-preco-sugerido\|btn-aplicar-preco-sugerido\|btn-salvar-receita' ficha-tecnica-bar/index.html
```

Expected: `4` (one occurrence of each id's `id="..."` attribute — `re-markup-alvo` and `re-preco-sugerido` also appear in the `<strong>`/`<input>` tags only once each).

If you have a way to open the page in a real browser (see Task 6 for the full manual-verification setup), you can also just load `ficha-tecnica-bar/index.html` and confirm the modal still opens and looks the same as before, plus the new "Markup alvo" field, "Preço sugerido" row, and "Salvar" button are visible but not yet wired to anything (clicking "Salvar" does nothing yet — expected, Task 5 wires it).

- [ ] **Step 6: Commit**

```bash
git add ficha-tecnica-bar/index.html ficha-tecnica-bar/style.css
git commit -m "Add markup field, suggested price row, and Salvar button markup"
```

---

### Task 4: `render.js` — draft-based rendering

**Files:**
- Modify: `ficha-tecnica-bar/render.js:9-15` (`refreshAll`)
- Modify: `ficha-tecnica-bar/render.js:209-255` (the `openReceitaEditor`/`closeReceitaEditor`/`renderReceitaEditor` section)

**Interfaces:**
- Consumes: `calcPrecoSugerido`, `calcCustoDraftItens` (Task 2); `getReceita`, `calcIndicadores`, `fmtMoeda`, `fmtPct`, `cmvClass`, `getInsumosParaSelect`, `updateUnidadeAviso`, `renderItemsTable`, `escapeHtml`, `query` (existing); the new DOM ids from Task 3.
- Produces (for Task 5 to consume): `abrirRascunhoDaReceita(id): void` (sets `state.receitaDraft`/`state.receitaDraftSalvo`), `openReceitaEditor(id): void` (unchanged signature, new body), `renderReceitaEditorCampos(): void`, `renderReceitaEditorComputados(): void`, `draftAddItem(insumoId, quantidade): void`, `draftUpdateItemQtd(itemId, quantidade): void`, `draftRemoveItem(itemId): void`, `fecharReceitaEditorComCheck(): void`.
- State shape (declared as initial keys in Task 5, but read/written starting in this task): `state.receitaDraft` and `state.receitaDraftSalvo`, both objects shaped `{ nome, categoria, copo, guarnicao, modo_preparo, preco_venda, utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo, itens: [{ id, tempId, insumo_id, quantidade, nome, unidade_compra, preco_unitario }] }`.

- [ ] **Step 1: Fix `refreshAll()`**

`ficha-tecnica-bar/render.js:9-15` currently:

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

Replace with:

```js
function refreshAll() {
  renderInsumos();
  renderReceitas();
  renderDashboard();
  renderEventos();
  if (state.editingReceitaId) renderReceitaEditorCampos();
  if (state.editingProducaoId) renderProducaoEditor();
  if (state.editingEventoId) renderEventoEditor();
}
```

- [ ] **Step 2: Replace the receita editor section**

`ficha-tecnica-bar/render.js:209-255` currently:

```js
// ---------- Editor de receita (modal) ----------
function openReceitaEditor(id) {
  state.editingReceitaId = id;
  document.getElementById('modal-overlay').classList.add('active');
  renderReceitaEditor();
}
function closeReceitaEditor() {
  state.editingReceitaId = null;
  document.getElementById('modal-overlay').classList.remove('active');
}
function renderReceitaEditor() {
  const r = getReceita(state.editingReceitaId);
  if (!r) return;
  const custo = calcCustoReceita(r.id);
  const { cmv, markup, margem } = calcIndicadores(custo, r.preco_venda);

  document.getElementById('re-nome').value = r.nome;
  document.getElementById('re-categoria').value = r.categoria || '';
  document.getElementById('re-copo').value = r.copo || '';
  document.getElementById('re-guarnicao').value = r.guarnicao || '';
  document.getElementById('re-modo-preparo').value = r.modo_preparo || '';
  document.getElementById('re-preco-venda').value = r.preco_venda;
  document.getElementById('re-utensilios').value = r.utensilios || '';
  document.getElementById('re-tempo-preparo').value = r.tempo_preparo || '';
  document.getElementById('re-rendimento').value = r.rendimento || '';
  document.getElementById('re-vendas-periodo').value = r.vendas_periodo || 0;

  document.getElementById('re-custo').textContent = fmtMoeda(custo);
  const cmvEl = document.getElementById('re-cmv');
  cmvEl.textContent = fmtPct(cmv);
  cmvEl.className = 'badge ' + cmvClass(cmv);
  document.getElementById('re-markup').textContent = markup ? markup.toFixed(2) + 'x' : '-';
  document.getElementById('re-margem').textContent = fmtMoeda(margem);

  renderItemsTable(
    document.getElementById('re-itens-tbody'),
    r.itens,
    'Nenhum insumo adicionado',
    updateReceitaItemQtd,
    removeReceitaItem
  );

  const select = document.getElementById('re-add-insumo');
  const insumos = getInsumosParaSelect();
  select.innerHTML = '<option value="">Selecionar insumo...</option>' + insumos.map((i) => `<option value="${i.id}" data-un="${i.unidade_compra}">${escapeHtml(i.nome)}</option>`).join('');
  updateUnidadeAviso(select, document.getElementById('re-add-unidade'));
}
```

Replace the whole block with:

```js
// ---------- Editor de receita (modal) ----------
// Edicao em rascunho: nada grava no banco ate clicar Salvar (main.js).
// renderReceitaEditorCampos() repovoa os inputs - roda so ao abrir ou depois
// de salvar. renderReceitaEditorComputados() so atualiza as areas derivadas
// (custo/CMV/preco sugerido/tabela de itens) e roda a cada edicao no
// rascunho - nunca reescreve o .value de um campo, senao o cursor pula pro
// fim do campo a cada tecla digitada.
function abrirRascunhoDaReceita(id) {
  const r = getReceita(id);
  state.receitaDraft = {
    nome: r.nome, categoria: r.categoria, copo: r.copo, guarnicao: r.guarnicao, modo_preparo: r.modo_preparo,
    preco_venda: r.preco_venda, utensilios: r.utensilios, tempo_preparo: r.tempo_preparo, rendimento: r.rendimento,
    vendas_periodo: r.vendas_periodo, markup_alvo: r.markup_alvo || 0,
    itens: r.itens.map((it) => ({ id: it.id, tempId: null, insumo_id: it.insumo_id, quantidade: it.quantidade, nome: it.nome, unidade_compra: it.unidade_compra, preco_unitario: it.preco_unitario })),
  };
  state.receitaDraftSalvo = JSON.parse(JSON.stringify(state.receitaDraft));
}
function openReceitaEditor(id) {
  state.editingReceitaId = id;
  abrirRascunhoDaReceita(id);
  document.getElementById('modal-overlay').classList.add('active');
  renderReceitaEditorCampos();
}
function closeReceitaEditor() {
  state.editingReceitaId = null;
  document.getElementById('modal-overlay').classList.remove('active');
}
function fecharReceitaEditorComCheck() {
  const sujo = JSON.stringify(state.receitaDraft) !== JSON.stringify(state.receitaDraftSalvo);
  if (sujo && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
  closeReceitaEditor();
  refreshAll();
}
function renderReceitaEditorCampos() {
  const d = state.receitaDraft;
  if (!d) return;
  document.getElementById('re-nome').value = d.nome;
  document.getElementById('re-categoria').value = d.categoria || '';
  document.getElementById('re-copo').value = d.copo || '';
  document.getElementById('re-guarnicao').value = d.guarnicao || '';
  document.getElementById('re-modo-preparo').value = d.modo_preparo || '';
  document.getElementById('re-preco-venda').value = d.preco_venda;
  document.getElementById('re-utensilios').value = d.utensilios || '';
  document.getElementById('re-tempo-preparo').value = d.tempo_preparo || '';
  document.getElementById('re-rendimento').value = d.rendimento || '';
  document.getElementById('re-vendas-periodo').value = d.vendas_periodo || 0;
  document.getElementById('re-markup-alvo').value = d.markup_alvo || 0;

  const select = document.getElementById('re-add-insumo');
  const insumos = getInsumosParaSelect();
  select.innerHTML = '<option value="">Selecionar insumo...</option>' + insumos.map((i) => `<option value="${i.id}" data-un="${i.unidade_compra}">${escapeHtml(i.nome)}</option>`).join('');
  updateUnidadeAviso(select, document.getElementById('re-add-unidade'));

  renderReceitaEditorComputados();
}
function renderReceitaEditorComputados() {
  const d = state.receitaDraft;
  if (!d) return;
  const custo = calcCustoDraftItens(d.itens);
  const precoSugerido = calcPrecoSugerido(custo, d.markup_alvo || 0);
  const { cmv, markup, margem } = calcIndicadores(custo, d.preco_venda);

  document.getElementById('re-custo').textContent = fmtMoeda(custo);
  document.getElementById('re-preco-sugerido').textContent = fmtMoeda(precoSugerido);
  const cmvEl = document.getElementById('re-cmv');
  cmvEl.textContent = fmtPct(cmv);
  cmvEl.className = 'badge ' + cmvClass(cmv);
  document.getElementById('re-markup').textContent = markup ? markup.toFixed(2) + 'x' : '-';
  document.getElementById('re-margem').textContent = fmtMoeda(margem);

  renderItemsTable(
    document.getElementById('re-itens-tbody'),
    d.itens.map((it) => ({ ...it, id: it.id ?? it.tempId })),
    'Nenhum insumo adicionado',
    draftUpdateItemQtd,
    draftRemoveItem
  );
}

let nextTempId = -1;
function draftAddItem(insumoId, quantidade) {
  const insumo = query('SELECT nome, unidade_compra, preco_unitario FROM insumos WHERE id = ?', [insumoId])[0];
  if (!insumo) return;
  state.receitaDraft.itens.push({ id: null, tempId: nextTempId--, insumo_id: insumoId, quantidade, ...insumo });
  renderReceitaEditorComputados();
}
function draftUpdateItemQtd(itemId, quantidade) {
  const it = state.receitaDraft.itens.find((i) => (i.id ?? i.tempId) === itemId);
  if (it) it.quantidade = quantidade;
  renderReceitaEditorComputados();
}
function draftRemoveItem(itemId) {
  state.receitaDraft.itens = state.receitaDraft.itens.filter((i) => (i.id ?? i.tempId) !== itemId);
  renderReceitaEditorComputados();
}
```

Note: `renderItemsTable`'s own qty/remove callbacks (attached inside that shared function) call `refreshAll()` after invoking the callback you pass it — check `ficha-tecnica-bar/render.js`'s `renderItemsTable` definition: its internal `change`/`click` listeners call `onQtyChange(...)`/`onRemove(...)` and then `refreshAll()`. Since `refreshAll()` now calls `renderReceitaEditorCampos()` when a receita is being edited (Step 1), this means editing an item quantity or removing an item will repopulate all fields via `renderReceitaEditorCampos()` — which is safe here specifically because the qty input's event is `change` (fires on blur, not on every keystroke), so there is no active cursor position to lose at that moment. This matches the existing app-wide convention (item quantity edits already used `change`, not `input`, before this plan).

- [ ] **Step 3: Verify with Node (no browser) — load render.js alongside db.js/model.js and exercise the draft functions**

This mirrors the technique used to verify the Eventos feature's model functions. `render.js` calls `document.*` APIs that don't exist in Node, so this check only exercises the non-DOM parts (`abrirRascunhoDaReceita`, `draftAddItem`, `draftUpdateItemQtd`, `draftRemoveItem`, and the pure calc functions) — it will NOT catch DOM-related mistakes (those need the manual browser pass in Task 6).

```bash
node -e "
const vm = require('vm');
const fs = require('fs');
const initSqlJs = require('./ficha-tecnica-bar/lib/sql-wasm.js');

initSqlJs({ locateFile: (f) => './ficha-tecnica-bar/lib/' + f }).then((SQL) => {
  const sandbox = {
    console, __SQL: SQL,
    document: { getElementById: () => ({ value: '', textContent: '', className: '', innerHTML: '', querySelectorAll: () => [] }) },
    state: {},
  };
  vm.createContext(sandbox);
  const combined = [
    fs.readFileSync('./ficha-tecnica-bar/db.js', 'utf8'),
    fs.readFileSync('./ficha-tecnica-bar/model.js', 'utf8'),
    fs.readFileSync('./ficha-tecnica-bar/render.js', 'utf8'),
    'SQL = __SQL; db = new SQL.Database(); db.run(SCHEMA_SQL); persist = function() {};',
  ].join('\n');
  vm.runInContext(combined, sandbox, { filename: 'combined.js' });

  const insumoId = sandbox.runInsert(\`INSERT INTO insumos (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual) VALUES ('Teste', '', '', '', 'ml', 1000, 100, 0.1, '', 'comprado', 1, 0, 0)\`);
  const receitaId = sandbox.runInsert(\`INSERT INTO receitas (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo) VALUES ('Receita Teste', '', '', '', '', 0, 1, '', '', '', 0, 0)\`);

  sandbox.abrirRascunhoDaReceita(receitaId);
  sandbox.draftAddItem(insumoId, 20);
  const custo1 = sandbox.calcCustoDraftItens(sandbox.state.receitaDraft.itens);
  console.log('custo apos add (esperado 2 = 20*0.1):', custo1);
  if (custo1 !== 2) throw new Error('FALHA no draftAddItem');

  const tempId = sandbox.state.receitaDraft.itens[0].tempId;
  sandbox.draftUpdateItemQtd(tempId, 50);
  const custo2 = sandbox.calcCustoDraftItens(sandbox.state.receitaDraft.itens);
  console.log('custo apos update qtd (esperado 5 = 50*0.1):', custo2);
  if (custo2 !== 5) throw new Error('FALHA no draftUpdateItemQtd');

  sandbox.draftRemoveItem(tempId);
  console.log('itens apos remove (esperado 0):', sandbox.state.receitaDraft.itens.length);
  if (sandbox.state.receitaDraft.itens.length !== 0) throw new Error('FALHA no draftRemoveItem');

  console.log('OK');
});
"
```

Expected: prints the three intermediate checks matching the comments, then `OK`.

- [ ] **Step 4: Commit**

```bash
git add ficha-tecnica-bar/render.js
git commit -m "Split receita editor into draft-based rendering"
```

---

### Task 5: `main.js` — wire draft bindings, Salvar, Aplicar

**Files:**
- Modify: `ficha-tecnica-bar/main.js:3-8` (`state`)
- Modify: `ficha-tecnica-bar/main.js` (inside `attachGlobalHandlers()`: the receita modal-close/overlay block, the receita `bindFormFields` call, and the `bindAddItemRow('btn-add-item', ...)` call)

**Interfaces:**
- Consumes: `fecharReceitaEditorComCheck`, `abrirRascunhoDaReceita`, `renderReceitaEditorComputados`, `draftAddItem`, `calcCustoDraftItens`, `calcPrecoSugerido` (Task 4/2); `updateUnidadeAviso` (existing); `deleteReceita`, `printReceita`, `updateReceitaField` (existing, now only called by `salvarReceita`, defined in this task).
- Produces: a fully clickable "Salvar"/"Aplicar" flow — last task before manual verification.

- [ ] **Step 1: Add `receitaDraft`/`receitaDraftSalvo` to `state`**

`ficha-tecnica-bar/main.js:3-8` currently:

```js
let state = {
  tab: 'insumos',
  insumoFiltro: '',
  editingReceitaId: null,
  editingProducaoId: null,
  editingEventoId: null,
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
  receitaDraft: null,
  receitaDraftSalvo: null,
};
```

- [ ] **Step 2: Add `salvarReceita`**

Add this function in `ficha-tecnica-bar/main.js`, right before `attachGlobalHandlers()`:

```js
function salvarReceita() {
  const id = state.editingReceitaId;
  const d = state.receitaDraft;
  const allowed = ['nome', 'categoria', 'copo', 'guarnicao', 'modo_preparo', 'preco_venda', 'utensilios', 'tempo_preparo', 'rendimento', 'vendas_periodo', 'markup_alvo'];
  for (const field of allowed) updateReceitaField(id, field, d[field]);

  const itensBanco = query('SELECT id FROM receita_itens WHERE receita_id = ?', [id]);
  const idsNoRascunho = new Set(d.itens.filter((it) => it.id).map((it) => it.id));
  for (const it of itensBanco) {
    if (!idsNoRascunho.has(it.id)) removeReceitaItem(it.id);
  }
  for (const it of d.itens) {
    if (it.id) updateReceitaItemQtd(it.id, it.quantidade);
    else addReceitaItem(id, it.insumo_id, it.quantidade);
  }

  abrirRascunhoDaReceita(id);
  refreshAll();
}
```

- [ ] **Step 3: Replace the receita modal-close/overlay handlers**

`ficha-tecnica-bar/main.js` currently has, inside `attachGlobalHandlers()`:

```js
  document.getElementById('modal-close').addEventListener('click', () => { closeReceitaEditor(); refreshAll(); });
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') { closeReceitaEditor(); refreshAll(); }
  });
  document.getElementById('btn-delete-receita').addEventListener('click', () => deleteReceita(state.editingReceitaId));
  document.getElementById('btn-print-receita').addEventListener('click', () => printReceita(state.editingReceitaId));
```

Replace with:

```js
  document.getElementById('modal-close').addEventListener('click', fecharReceitaEditorComCheck);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') fecharReceitaEditorComCheck();
  });
  document.getElementById('btn-salvar-receita').addEventListener('click', salvarReceita);
  document.getElementById('btn-delete-receita').addEventListener('click', () => deleteReceita(state.editingReceitaId));
  document.getElementById('btn-print-receita').addEventListener('click', () => printReceita(state.editingReceitaId));
```

- [ ] **Step 4: Replace the receita `bindFormFields`/`bindAddItemRow` calls**

`ficha-tecnica-bar/main.js` currently has, further down in `attachGlobalHandlers()`:

```js
  bindFormFields(
    ['re-nome', 're-categoria', 're-copo', 're-guarnicao', 're-modo-preparo', 're-preco-venda', 're-utensilios', 're-tempo-preparo', 're-rendimento', 're-vendas-periodo'],
    {
      're-nome': 'nome', 're-categoria': 'categoria', 're-copo': 'copo', 're-guarnicao': 'guarnicao',
      're-modo-preparo': 'modo_preparo', 're-preco-venda': 'preco_venda', 're-utensilios': 'utensilios',
      're-tempo-preparo': 'tempo_preparo', 're-rendimento': 'rendimento', 're-vendas-periodo': 'vendas_periodo',
    },
    ['preco_venda', 'vendas_periodo'],
    () => state.editingReceitaId,
    updateReceitaField
  );
  bindAddItemRow('btn-add-item', 're-add-insumo', 're-add-qtd', 're-add-unidade', () => state.editingReceitaId, addReceitaItem);
```

Replace with:

```js
  bindDraftFormFields(
    ['re-nome', 're-categoria', 're-copo', 're-guarnicao', 're-modo-preparo', 're-preco-venda', 're-utensilios', 're-tempo-preparo', 're-rendimento', 're-vendas-periodo', 're-markup-alvo'],
    {
      're-nome': 'nome', 're-categoria': 'categoria', 're-copo': 'copo', 're-guarnicao': 'guarnicao',
      're-modo-preparo': 'modo_preparo', 're-preco-venda': 'preco_venda', 're-utensilios': 'utensilios',
      're-tempo-preparo': 'tempo_preparo', 're-rendimento': 'rendimento', 're-vendas-periodo': 'vendas_periodo',
      're-markup-alvo': 'markup_alvo',
    },
    ['preco_venda', 'vendas_periodo', 'markup_alvo']
  );

  const reAddInsumoSelect = document.getElementById('re-add-insumo');
  reAddInsumoSelect.addEventListener('change', (e) => updateUnidadeAviso(e.target, document.getElementById('re-add-unidade')));
  document.getElementById('btn-add-item').addEventListener('click', () => {
    const qtdInput = document.getElementById('re-add-qtd');
    const insumoId = Number(reAddInsumoSelect.value);
    const qtd = parseFloat(qtdInput.value);
    if (!insumoId || !qtd) return;
    draftAddItem(insumoId, qtd);
    qtdInput.value = '';
    reAddInsumoSelect.value = '';
    updateUnidadeAviso(reAddInsumoSelect, document.getElementById('re-add-unidade'));
  });

  document.getElementById('btn-aplicar-preco-sugerido').addEventListener('click', () => {
    const custo = calcCustoDraftItens(state.receitaDraft.itens);
    const sugerido = calcPrecoSugerido(custo, state.receitaDraft.markup_alvo || 0);
    state.receitaDraft.preco_venda = sugerido;
    document.getElementById('re-preco-venda').value = sugerido;
    renderReceitaEditorComputados();
  });
```

`bindAddItemRow` (the generic helper) is left untouched in the file — it is still used by the produção interna editor's `bindAddItemRow('btn-add-pritem', ...)` call, which is not part of this task and must not be removed.

- [ ] **Step 5: Add `bindDraftFormFields`**

Add this function in `ficha-tecnica-bar/main.js`, right after the existing `bindFormFields` function definition:

```js
// Igual a bindFormFields, mas grava no rascunho da receita em memoria (state.receitaDraft)
// em vez de gravar direto no banco - nada persiste ate clicar Salvar.
function bindDraftFormFields(ids, fieldMap, numericFields) {
  ids.forEach((id) => {
    document.getElementById(id).addEventListener('input', (e) => {
      const field = fieldMap[id];
      let value = e.target.value;
      if (numericFields.includes(field)) value = parseFloat(value) || 0;
      state.receitaDraft[field] = value;
      renderReceitaEditorComputados();
    });
  });
}
```

- [ ] **Step 6: Verify with `node --check`**

```bash
node --check ficha-tecnica-bar/main.js
```

Expected: no output (syntax OK). This does not catch runtime/DOM issues — those are verified in Task 6.

- [ ] **Step 7: Run the full unit test suite**

```bash
cd ficha-tecnica-bar
node --test
```

Expected: all 17 tests still pass (nothing in this task touches `model.js`, but this is a checkpoint before the manual pass).

- [ ] **Step 8: Commit**

```bash
git add ficha-tecnica-bar/main.js
git commit -m "Wire draft-based Salvar/Aplicar for ficha tecnica editor"
```

---

### Task 6: Full end-to-end manual verification

**Files:** None modified — verification only.

- [ ] **Step 1: Serve the app locally**

```bash
cd ficha-tecnica-bar
python -m http.server 8846
```

(Use a port not already in use. If `browser-harness` is unavailable due to a local security policy block, drive the browser manually or through whatever browser automation tool is available — e.g. a Chrome-extension-based tool — instead of skipping this task.)

- [ ] **Step 2: Baseline check — existing recipes still open correctly**

Open `http://127.0.0.1:8846/index.html`, go to "Fichas Técnicas", open any existing recipe. Confirm:
- All fields show the recipe's current saved values (including "Markup alvo" showing `0` if never set).
- "Preço sugerido" shows `R$ 0,00` if markup alvo is `0`.
- Existing insumo items list correctly with their real quantities/costs.

- [ ] **Step 3: Draft editing does not persist until Salvar**

With a recipe open:
1. Change "Nome", "Categoria", and "Preço de venda" to new values.
2. Set "Markup alvo" to `3` (type it or use the spinner).
3. Add a new insumo to the recipe via the "Adicionar" row.
4. Remove one existing insumo from the list.
5. **Without clicking Salvar**, close the modal via ✕.

Expected: a confirm dialog appears ("Você tem alterações não salvas..."). Click Cancel/dismiss in a way that keeps you in the page (do not confirm the leave) — the modal should stay open with your edits intact. Then re-open the same recipe from the "Fichas Técnicas" list in a new browser tab or via a page reload in the same tab (discard the unsaved changes for this check by actually confirming the leave this time) — confirm the recipe reverted to its original values (nothing you typed was saved).

- [ ] **Step 4: Cursor does not jump while typing**

Open a recipe, click into "Nome", and type several characters in the middle of the existing text (not at the end). Confirm the cursor stays where you're typing and does not jump to the end of the field after each keystroke. Repeat for the "Modo de preparo" textarea.

- [ ] **Step 5: Markup stepper and suggested price**

With a recipe open (that has at least one insumo, so custo > 0):
1. Click the up arrow on "Markup alvo" several times — confirm it increases by `0.5` each click, and "Preço sugerido" updates immediately after each click (no need to click elsewhere).
2. Click the down arrow — confirm it decreases by `0.5` and "Preço sugerido" updates.
3. Click "Aplicar" — confirm "Preço de venda" changes to match "Preço sugerido", and that CMV / Markup (indicator) / Margem all recompute to match the new price.

- [ ] **Step 6: Save persists everything, including new items with real ids**

With the same recipe still open and the edits from Steps 3 and 5 still present in the form (re-do them if you discarded them in Step 3):
1. Click "Salvar".
2. Confirm the modal stays open (Salvar does not close it).
3. Close the modal (✕) — no confirm dialog should appear this time (nothing pending).
4. Reload the page (F5), navigate back to "Fichas Técnicas", re-open the same recipe.
5. Confirm: new name/categoria/preço/markup persisted, the newly added insumo is present (and its quantity can be edited/removed like any other item — proving it got a real database id, not a leftover temp id), the removed insumo is gone.

- [ ] **Step 7: Other editors unaffected**

Open the Insumos tab, edit a price directly in the table (not in a modal) — confirm it still saves immediately as before (no Salvar button involved, unaffected by this plan). Open a "Produção interna" item and an "Evento" — confirm both still autosave on field change exactly as before (no Salvar button appears in those modals).

- [ ] **Step 8: Stop the test server**

```bash
netstat -ano | grep ":8846" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

(On non-Windows environments, use `lsof -i :8846` and `kill <pid>` instead.)

- [ ] **Step 9: Final commit-worthy state check**

```bash
cd ficha-tecnica-bar
node --test
```

Expected: all 17 tests pass. If any manual step in this task failed, fix the relevant earlier task before considering this plan complete — do not proceed to `finishing-a-development-branch` with a failing manual check.

---

## Post-plan note

Out of scope per the spec's "Fora de escopo" section — do not add without a new spec: markup suggestion from a target CMV (inverse direction), any link to the Eventos feature, explicit-save behavior for insumo/produção/evento editors, printing from an unsaved draft.
