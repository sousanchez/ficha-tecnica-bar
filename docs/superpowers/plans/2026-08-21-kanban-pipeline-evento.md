# Kanban pipeline evento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Kanban view (Lead → Proposta → Confirmado → Realizado) to the existing Eventos tab in `ficha-tecnica-bar/`, as an alternative to the current list view, so estágio comercial of each evento is visible at a glance.

**Architecture:** One new schema column (`eventos.estagio`), one new exported constant (`ESTAGIOS_EVENTO`), one new render function (`renderEventosKanban`), and a small view-toggle (`state.eventosView`) that shows/hides the existing list vs. the new board. No new tables, no new model functions beyond whitelisting the field — stage changes reuse the existing `updateEventoField`/`setField` machinery untouched.

**Tech Stack:** Plain HTML/CSS/JS (no framework, no build step), sql.js (SQLite-in-WASM) for persistence, `node --test` for the one pure-data unit test.

## Global Constraints

- Static, client-side app: plain HTML/CSS/JS, no build step, no backend/server dependency. Must stay this way.
- Data persistence entirely local via sql.js; database travels as a single `.db` file (export/import), never synced to a server.
- UI language is Portuguese (pt-BR) — all new labels/text must be in Portuguese.
- Single-owner tool: no auth, no multi-user, no multi-tenant. This feature is purely a visualization/interaction change, not a new capability that needs access control.
- 4 estágios exactly: `lead`, `proposta`, `confirmado`, `realizado` (labels: Lead, Proposta, Confirmado, Realizado) — see `docs/superpowers/specs/2026-08-21-kanban-pipeline-evento-design.md`.
- Stage change is dropdown-driven (no drag-and-drop) and only writes the new value — no timestamps, no edit-lock on `realizado`.
- Kanban is an additional view (toggle), not a replacement of the existing list view.
- Eventos already saved before this change must default to `lead` (handled via SQL `DEFAULT`, verified manually against a pre-existing saved DB).

---

## Task 1: Schema column + `ESTAGIOS_EVENTO` constant + whitelist

**Files:**
- Modify: `ficha-tecnica-bar/db.js:93-105` (migrateSchema)
- Modify: `ficha-tecnica-bar/model.js:270-299` (Eventos section, `updateEventoField`)
- Modify: `ficha-tecnica-bar/model.js:358-360` (module.exports block)
- Test: `ficha-tecnica-bar/model.test.js`

**Interfaces:**
- Produces: `ESTAGIOS_EVENTO` — array of `{ valor: string, label: string }`, 4 entries in order `lead`/`proposta`/`confirmado`/`realizado`. Exported from `model.js`, consumed as a global (script-tag scope, no import) by `render.js` in Task 2.
- Produces: `eventos.estagio` column (TEXT, default `'lead'`) in the sql.js schema, and `'estagio'` accepted by the existing `updateEventoField(id, field, value)` (unchanged signature).

- [ ] **Step 1: Write the failing test for `ESTAGIOS_EVENTO`**

Add to `ficha-tecnica-bar/model.test.js` (after the existing requires, add `ESTAGIOS_EVENTO` to the destructured import):

```js
const {
  calcIndicadores, computeMenuEngineering, cmvClass, calcCustoEventoPessoa, calcPrecoSugerido,
  calcCustoDraftItens, calcCustoUnitario, calcTotaisEvento, cmvIcon, ESTAGIOS_EVENTO,
} = require('./model.js');
```

Then add a new test anywhere after the existing ones:

```js
test('ESTAGIOS_EVENTO: 4 estagios na ordem Lead/Proposta/Confirmado/Realizado', () => {
  assert.deepEqual(
    ESTAGIOS_EVENTO.map((e) => e.valor),
    ['lead', 'proposta', 'confirmado', 'realizado'],
  );
  assert.deepEqual(
    ESTAGIOS_EVENTO.map((e) => e.label),
    ['Lead', 'Proposta', 'Confirmado', 'Realizado'],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ficha-tecnica-bar && npm test`
Expected: FAIL — `ESTAGIOS_EVENTO` is `undefined` (`Cannot read properties of undefined (reading 'map')`), because it isn't defined in `model.js` yet.

- [ ] **Step 3: Add the schema column**

In `ficha-tecnica-bar/db.js`, inside `migrateSchema()` (currently lines 87-109), add the new column next to the other `addColIfMissing` calls and its matching backfill `UPDATE`, following the exact pattern already used for `tipo`/`estoque_minimo`/etc.:

```js
function migrateSchema() {
  const addColIfMissing = (table, colDef) => {
    const colName = colDef.split(' ')[0];
    const cols = query(`PRAGMA table_info(${table})`).map((c) => c.name);
    if (!cols.includes(colName)) db.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  };
  addColIfMissing('insumos', "tipo TEXT DEFAULT 'comprado'");
  addColIfMissing('insumos', 'fator_correcao REAL DEFAULT 1');
  addColIfMissing('insumos', 'estoque_minimo REAL DEFAULT 0');
  addColIfMissing('insumos', 'estoque_atual REAL DEFAULT 0');
  addColIfMissing('receitas', "utensilios TEXT DEFAULT ''");
  addColIfMissing('receitas', "tempo_preparo TEXT DEFAULT ''");
  addColIfMissing('receitas', "rendimento TEXT DEFAULT ''");
  addColIfMissing('receitas', 'vendas_periodo REAL DEFAULT 0');
  addColIfMissing('receitas', 'markup_alvo REAL DEFAULT 0');
  addColIfMissing('eventos', "estagio TEXT DEFAULT 'lead'");
  db.run("UPDATE insumos SET tipo = 'comprado' WHERE tipo IS NULL");
  db.run('UPDATE insumos SET fator_correcao = 1 WHERE fator_correcao IS NULL');
  db.run('UPDATE insumos SET estoque_minimo = 0 WHERE estoque_minimo IS NULL');
  db.run('UPDATE insumos SET estoque_atual = 0 WHERE estoque_atual IS NULL');
  db.run("UPDATE eventos SET estagio = 'lead' WHERE estagio IS NULL");
  seedProducaoPropria();
  seedFichasFlorest();
  persist();
}
```

(Only the `addColIfMissing('eventos', ...)` line and the matching `UPDATE eventos ...` line are new; everything else shown is existing code, reproduced here so the diff context is unambiguous.)

- [ ] **Step 4: Add `ESTAGIOS_EVENTO`, whitelist `estagio`, and export**

In `ficha-tecnica-bar/model.js`, right after the `// ---------- Eventos (pacotes) ----------` comment (line 270), before `calcCustoEventoPessoa`, add:

```js
const ESTAGIOS_EVENTO = [
  { valor: 'lead', label: 'Lead' },
  { valor: 'proposta', label: 'Proposta' },
  { valor: 'confirmado', label: 'Confirmado' },
  { valor: 'realizado', label: 'Realizado' },
];
```

Then update `updateEventoField` (currently lines 297-300) to whitelist the new field:

```js
function updateEventoField(id, field, value) {
  const allowed = ['nome', 'data', 'convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa', 'estagio'];
  setField('eventos', allowed, id, field, value);
}
```

Finally, add `ESTAGIOS_EVENTO` to the `module.exports` block (currently lines 358-361):

```js
if (typeof module !== 'undefined') {
  module.exports = {
    calcIndicadores, computeMenuEngineering, fmtMoeda, fmtPct, cmvClass, calcCustoEventoPessoa,
    calcPrecoSugerido, calcCustoDraftItens, calcCustoUnitario, calcTotaisEvento, cmvIcon,
    ESTAGIOS_EVENTO,
  };
}
```

(Reproduce the exact existing export list from your read of the file — the point is adding `ESTAGIOS_EVENTO` as one more property, not reordering what's already exported.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ficha-tecnica-bar && npm test`
Expected: PASS — including the new `ESTAGIOS_EVENTO` test and all pre-existing tests still green.

- [ ] **Step 6: Manually verify the schema migration on a real saved DB**

This part (`db.js`) only runs inside a browser (sql.js + `localStorage`), so verify with a throwaway local server, same approach as the existing `2026-08-09-custeio-eventos.md` plan used:

```bash
cd ficha-tecnica-bar
python -m http.server 8842 &
```

Using a browser (or the `browser-harness` skill), open `http://127.0.0.1:8842/index.html` **without clearing localStorage** (so it loads your real, already-saved DB and exercises `migrateSchema()`, not the fresh-DB seed path), and in the page console run:

```js
JSON.stringify(query('PRAGMA table_info(eventos)'))
```

Expected: the result includes a column named `estagio`. Then run:

```js
JSON.stringify(query('SELECT id, nome, estagio FROM eventos'))
```

Expected: every existing evento row shows `"estagio":"lead"`.

Stop the test server when done:

```bash
netstat -ano | grep ":8842" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

- [ ] **Step 7: Commit**

```bash
cd ficha-tecnica-bar
git add db.js model.js model.test.js
git commit -m "feat(eventos): adiciona coluna estagio e ESTAGIOS_EVENTO"
```

---

## Task 2: Kanban render function + view-toggle wiring in `renderTabs`

**Files:**
- Modify: `ficha-tecnica-bar/render.js:3-27` (`refreshAll`, `renderTabs`)
- Modify: `ficha-tecnica-bar/render.js` (new function `renderEventosKanban`, placed right after the existing `renderEventos` at line 203)

**Interfaces:**
- Consumes: `ESTAGIOS_EVENTO` (from Task 1, global scope), `getEventos()`, `calcIndicadores`, `cmvClass`, `cmvIcon`, `fmtMoeda`, `fmtPct`, `escapeHtml`, `updateEventoField` (all pre-existing globals used the same way `renderEventos` already uses them), `state.eventosView` (from Task 3 — this task reads/writes it, Task 3 initializes it and adds the buttons that set it).
- Produces: `renderEventosKanban()` — renders into `#eventos-kanban` (element added in Task 3). `renderTabs()` gains the view-toggle DOM sync (button active state + show/hide of `#eventos-list` / `#eventos-kanban`) that Task 3's buttons rely on.

- [ ] **Step 1: Add `renderEventosKanban` right after `renderEventos`**

In `ficha-tecnica-bar/render.js`, immediately after the existing `renderEventos()` function (ends at line 203 with `}`), add:

```js
function renderEventosKanban() {
  const eventos = getEventos();
  const board = document.getElementById('eventos-kanban');
  board.innerHTML = ESTAGIOS_EVENTO.map((estagio) => {
    const doEstagio = eventos.filter((e) => e.estagio === estagio.valor);
    const cardsHtml = doEstagio.map((e) => {
      const { cmv } = calcIndicadores(e.custoPorPessoa, e.preco_pacote_pessoa);
      const optionsHtml = ESTAGIOS_EVENTO.map((opt) =>
        `<option value="${opt.valor}" ${opt.valor === e.estagio ? 'selected' : ''}>${opt.label}</option>`
      ).join('');
      return `
        <div class="receita-card" onclick="openEventoEditor(${e.id})">
          <div class="receita-card-title">${escapeHtml(e.nome)}</div>
          <div class="receita-card-row"><span>Convidados</span><strong>${e.convidados}</strong></div>
          <div class="receita-card-row"><span>Custo/pessoa</span><strong>${fmtMoeda(e.custoPorPessoa)}</strong></div>
          <div class="receita-card-row"><span>CMV</span><strong class="badge ${cmvClass(cmv)}">${cmvIcon(cmv)}${fmtPct(cmv)}</strong></div>
          <select class="kanban-card-estagio" onclick="event.stopPropagation()" onchange="updateEventoField(${e.id}, 'estagio', this.value); refreshAll();">
            ${optionsHtml}
          </select>
        </div>
      `;
    }).join('') || '<p class="muted">Nenhum evento.</p>';
    return `
      <div class="kanban-col">
        <div class="kanban-col-title">${estagio.label} (${doEstagio.length})</div>
        ${cardsHtml}
      </div>
    `;
  }).join('');
}
```

- [ ] **Step 2: Wire it into `refreshAll`**

In `ficha-tecnica-bar/render.js`, `refreshAll()` (lines 9-18), add the call right after `renderEventos();`:

```js
function refreshAll() {
  renderInsumos();
  renderReceitas();
  renderDashboard();
  renderEventos();
  renderEventosKanban();
  renderProducoes();
  if (state.editingReceitaId) renderReceitaEditorCampos();
  if (state.editingProducaoId) renderProducaoEditorCampos();
  if (state.editingEventoId) renderEventoEditorCampos();
}
```

- [ ] **Step 3: Add the view-toggle DOM sync to `renderTabs`**

In `ficha-tecnica-bar/render.js`, `renderTabs()` (lines 20-27), change the first `querySelectorAll('.tab-btn')` to only match real tabs (so it doesn't fight over the new view-toggle buttons added in Task 3, which will also carry the `tab-btn` class for shared styling), and add the view-toggle sync:

```js
function renderTabs() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${state.tab}`);
  });
  document.querySelectorAll('.eventos-view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === state.eventosView);
  });
  document.getElementById('eventos-list').style.display = state.eventosView === 'lista' ? '' : 'none';
  document.getElementById('eventos-kanban').style.display = state.eventosView === 'kanban' ? '' : 'none';
}
```

(The `[data-tab]` attribute selector is the only change to the first block; it's what keeps this task's view-toggle buttons — added by class `eventos-view-btn` in Task 3 — from being flipped back to inactive by the tab-switching loop.)

- [ ] **Step 4: Commit**

This task can't be exercised standalone yet — `#eventos-kanban`, `#eventos-list` display toggling, and the `.eventos-view-btn` elements don't exist in the DOM until Task 3 adds them to `index.html`. Commit as an intermediate step; Task 3's manual test step is what verifies this code path end-to-end.

```bash
cd ficha-tecnica-bar
git add render.js
git commit -m "feat(eventos): renderEventosKanban e sincronizacao do view-toggle"
```

---

## Task 3: HTML markup, CSS, and `main.js` wiring — full manual verification

**Files:**
- Modify: `ficha-tecnica-bar/index.html:94-100` (`#tab-eventos` section)
- Modify: `ficha-tecnica-bar/style.css` (append new rules after the existing `.receita-card-row strong` rule, currently line 189)
- Modify: `ficha-tecnica-bar/main.js:3-15` (`state` object)
- Modify: `ficha-tecnica-bar/main.js:99-105` (`attachGlobalHandlers`)

**Interfaces:**
- Consumes: `renderTabs()`, `renderEventosKanban()`, `refreshAll()` (from Task 2); `ESTAGIOS_EVENTO`, `updateEventoField` (from Task 1).
- Produces: the complete, user-visible Kanban toggle. Nothing downstream depends on this task — it's the last one.

- [ ] **Step 1: Update the Eventos tab markup**

In `ficha-tecnica-bar/index.html`, replace the `#tab-eventos` section (currently lines 94-100):

```html
<section id="tab-eventos" class="tab-panel">
  <div class="toolbar">
    <span class="muted">Pacotes de evento (custo e preço por pessoa)</span>
    <button class="tab-btn eventos-view-btn active" data-view="lista">Lista</button>
    <button class="tab-btn eventos-view-btn" data-view="kanban">Kanban</button>
    <button id="btn-add-evento" class="btn">+ Novo evento</button>
  </div>
  <div id="eventos-list" class="receitas-grid"></div>
  <div id="eventos-kanban" class="kanban-board" style="display:none;"></div>
</section>
```

(`#eventos-kanban` starts with inline `display:none` matching the default `state.eventosView = 'lista'` set in Step 3 below, so there's no flash of an unstyled/empty board before the first `renderTabs()` call.)

- [ ] **Step 2: Add Kanban board CSS**

In `ficha-tecnica-bar/style.css`, append after the existing `.receita-card-row strong { color: var(--text); }` rule (currently line 189):

```css

.kanban-board {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.kanban-col {
  flex: 1;
  min-width: 220px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
}
.kanban-col-title {
  font-weight: 700;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: .03em;
}
.kanban-col .receita-card { margin-bottom: 10px; }
.kanban-col .receita-card:last-child { margin-bottom: 0; }
.kanban-card-estagio { width: 100%; margin-top: 8px; }
```

- [ ] **Step 3: Add `eventosView` to `state` and wire the toggle buttons**

In `ficha-tecnica-bar/main.js`, add `eventosView: 'lista',` to the `state` object (currently lines 3-15):

```js
let state = {
  tab: 'insumos',
  insumoFiltro: '',
  eventosView: 'lista',
  editingReceitaId: null,
  editingProducaoId: null,
  editingEventoId: null,
  receitaDraft: null,
  receitaDraftSalvo: null,
  producaoDraft: null,
  producaoDraftSalvo: null,
  eventoDraft: null,
  eventoDraftSalvo: null,
};
```

Then in `attachGlobalHandlers()` (starts line 99), add the click wiring right after the existing `.tab-btn` block (currently lines 100-105):

```js
function attachGlobalHandlers() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      renderTabs();
    });
  });
  document.querySelectorAll('.eventos-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.eventosView = btn.dataset.view;
      renderTabs();
    });
  });
  document.getElementById('filtro-nome').addEventListener('input', (e) => {
    state.insumoFiltro = e.target.value;
    renderInsumos();
  });
  // ... rest of the function unchanged
```

(Only the added `.eventos-view-btn` block and the `[data-tab]` attribute-selector change to the first block are new; everything else in `attachGlobalHandlers` stays as-is.)

- [ ] **Step 4: Run the unit tests once more**

Run: `cd ficha-tecnica-bar && npm test`
Expected: PASS (no test touches HTML/CSS/main.js, so this just guards against an accidental syntax break elsewhere).

- [ ] **Step 5: Manual end-to-end browser verification**

```bash
cd ficha-tecnica-bar
python -m http.server 8842 &
```

Using a browser (or the `browser-harness` skill), open `http://127.0.0.1:8842/index.html` with your real saved DB (don't clear localStorage), go to the **Eventos** tab, and:

1. Click **+ Novo evento** — confirm the new card appears in the list view, then click the **Kanban** toggle button — confirm the same new event shows up in the **Lead** column (it should, since `estagio` defaults to `'lead'` on insert).
2. On that test event's Kanban card, change the `<select>` to **Proposta** — confirm the card moves to the Proposta column immediately (no page reload needed) and clicking the `<select>` itself does **not** open the evento editor modal.
3. Advance it through **Confirmado** and **Realizado** the same way — confirm it lands in the correct column each time.
4. Click the **Lista** toggle button — confirm the list view reappears (Kanban board hides) and the test event card is still there (list view doesn't show stage, that's expected — it's the same underlying row).
5. Delete the test event (open it from either view, use the existing delete button in the evento editor) so no leftover test data remains.
6. Reload the page — confirm existing (real, pre-existing) eventos still show `Lead` as their stage in the Kanban view (this is the migration default from Task 1, now visually confirmed).

Stop the test server when done:

```bash
netstat -ano | grep ":8842" | grep LISTENING
taskkill //PID <pid-from-above> //F
```

- [ ] **Step 6: Commit**

```bash
cd ficha-tecnica-bar
git add index.html style.css main.js
git commit -m "feat(eventos): toggle Lista/Kanban na aba Eventos"
```
