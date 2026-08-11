# Aba "Produções" + custeio real das produções da casa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar uma aba própria ("Produções") pros insumos `tipo='producao_interna'` (hoje misturados na tabela de Insumos) e converter 4 insumos "revisar" (preço 0) — Xarope de Açúcar Simples, Super Suco, Shrub de Tangerina, Vodka com Chá do Amor — em produção interna de verdade, com sub-receita calculada a partir de outros insumos.

**Architecture:** Migração de dados idempotente em `db.js` (mesmo padrão de `migrateSchema()` que já roda em todo load de banco existente); nova aba reaproveita 100% o modal/editor de produção interna que já existe, só reorganiza onde as listas aparecem (`render.js`/`index.html`). Nenhuma mudança em `main.js` — o botão que abre "Nova produção interna" só muda de posição no HTML, o `id` e o handler continuam os mesmos.

**Tech Stack:** Vanilla JS/HTML/CSS, sql.js (SQLite/WASM), sem build step — mesmo stack do resto do app.

## Global Constraints

- Nomes de insumo sem acento, maiúsculo, batendo exatamente com os já criados na população das 14 fichas técnicas hoje (`XAROPE DE ACUCAR (SIMPLES)`, `SUPER SUCO`, `SHRUB DE TANGERINA CLEMENTINA`, `VODKA COM CHA DO AMOR (TALCHA)`, `AGUA FILTRADA`, `LIMAO TAHITI`, `ACUCAR REFINADO`, `SAL REFINADO`, `ABSOLUT 1L`) — a migração casa por nome exato, sem isso ela não encontra o insumo pra converter.
- Migração precisa ser **idempotente**: rodar de novo em um banco já migrado não pode duplicar insumo nem duplicar `producao_itens`.
- Migração só se aplica a bancos que já passaram pela população das 14 fichas (têm os insumos "revisar" pelo nome acima). Banco novo/limpo não tem esses nomes — a migração deve ser um no-op silencioso nesse caso, não deve quebrar nem criar nada pela metade.
- Preços exatos a usar (pesquisados, não inventar outro valor): Ácido Cítrico R$30,90/kg · Ácido Málico R$45,00/kg · Vinagre de Maçã R$19,98/L · Chá do Amor (Talchá) R$79,00/50g. Suco de Tangerina fica sem preço (revisar, R$0).

---

### Task 1: Migração de dados em `db.js` — `seedProducaoPropria()`

**Files:**
- Modify: `ficha-tecnica-bar/db.js` (nova função `seedProducaoPropria()`, chamada dentro de `migrateSchema()`)

**Interfaces:**
- Consumes: `query`, `run`, `runInsert`, `updateInsumoField` (já existem em `db.js`/`model.js`), `recalcInsumoUnitario`, `recalcAllProducoesInternas` (já existem em `model.js`, carregado depois de `db.js` no `index.html` mas chamado só em runtime, então a ordem de `<script>` não importa).
- Produces: nada que outro arquivo consome diretamente — efeito é só dado no banco. Task 2 depende do RESULTADO (insumos com `tipo='producao_interna'` existindo), não de nenhuma função nova.

- [ ] **Step 1: Adicionar `seedProducaoPropria()` em `db.js`**

Inserir depois de `seedInsumos()` (por volta da linha 120 do arquivo atual):

```js
// Converte insumos "revisar" (comprado, preco 0) que na verdade sao
// producoes proprias da casa em producao_interna de verdade, com
// sub-receita. So converte o que ja existir pelo nome - se o banco nao
// passou pela populacao das fichas do Florest, e um no-op silencioso.
// Idempotente: cada parte checa o estado atual antes de agir, entao rodar
// de novo em um banco ja migrado nao duplica nada.
function seedProducaoPropria() {
  const buscarOuCriarInsumo = (nome, categoria, unidade_compra, tamanho_unidade, preco_compra) => {
    const existente = query('SELECT id FROM insumos WHERE nome = ?', [nome])[0];
    if (existente) return existente.id;
    const id = runInsert(`INSERT INTO insumos
      (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
      VALUES (?, ?, '', '', ?, ?, ?, 0, '', 'comprado', 1, 0, 0)`,
      [nome, categoria, unidade_compra, tamanho_unidade, preco_compra]);
    recalcInsumoUnitario(id);
    return id;
  };

  // Insumos ja existentes cadastrados como "unidade" (pacote inteiro) mas
  // que sao vendidos por peso - preco ja bate com pacote de 1kg, entao so
  // ajusta a base de calculo, preco fica igual.
  const corrigirUnidade = (nome, unidade, tamanho) => {
    const row = query('SELECT id, unidade_compra FROM insumos WHERE nome = ?', [nome])[0];
    if (!row || row.unidade_compra === unidade) return;
    updateInsumoField(row.id, 'unidade_compra', unidade);
    updateInsumoField(row.id, 'tamanho_unidade', tamanho);
  };
  corrigirUnidade('ACUCAR REFINADO', 'g', 1000);
  corrigirUnidade('SAL REFINADO', 'g', 1000);

  const idAcidoCitrico = buscarOuCriarInsumo('ACIDO CITRICO', 'Xarope/Bitter', 'g', 1000, 30.90);
  const idAcidoMalico = buscarOuCriarInsumo('ACIDO MALICO', 'Xarope/Bitter', 'g', 1000, 45.00);
  const idVinagreMaca = buscarOuCriarInsumo('VINAGRE DE MACA', 'Outros', 'ml', 1000, 19.98);
  const idChaDoAmor = buscarOuCriarInsumo('CHA DO AMOR (TALCHA)', 'Produção interna', 'g', 50, 79.00);
  const idSucoTangerina = buscarOuCriarInsumo('SUCO DE TANGERINA', 'Suco', 'ml', 1000, 0);

  // Converte um insumo "comprado" em producao_interna e grava os
  // ingredientes - so age se o insumo existir e ainda estiver como
  // "comprado" (depois de convertido, tipo muda e essa checagem falha
  // sozinha nas proximas execucoes).
  const converterEmProducao = (nome, tamanhoLote, unidadeLote, itens) => {
    const row = query("SELECT id FROM insumos WHERE nome = ? AND tipo = 'comprado'", [nome])[0];
    if (!row) return;
    run("UPDATE insumos SET tipo = 'producao_interna', unidade_compra = ?, tamanho_unidade = ? WHERE id = ?",
      [unidadeLote, tamanhoLote, row.id]);
    for (const [insumoId, quantidade] of itens) {
      if (!insumoId) continue; // insumo-base nao encontrado - pula esse item em vez de gravar id invalido
      run('INSERT INTO producao_itens (producao_id, ingrediente_id, quantidade) VALUES (?, ?, ?)', [row.id, insumoId, quantidade]);
    }
  };

  const idAcucar = query("SELECT id FROM insumos WHERE nome = 'ACUCAR REFINADO'")[0]?.id;
  const idAgua = query("SELECT id FROM insumos WHERE nome = 'AGUA FILTRADA'")[0]?.id;
  const idLimaoTahiti = query("SELECT id FROM insumos WHERE nome = 'LIMAO TAHITI'")[0]?.id;
  const idSal = query("SELECT id FROM insumos WHERE nome = 'SAL REFINADO'")[0]?.id;
  const idAbsolut = query("SELECT id FROM insumos WHERE nome = 'ABSOLUT 1L'")[0]?.id;

  if (idAcucar && idAgua) {
    converterEmProducao('XAROPE DE ACUCAR (SIMPLES)', 2000, 'ml', [[idAcucar, 1000], [idAgua, 1000]]);
  }
  if (idAgua && idLimaoTahiti && idAcucar && idSal) {
    converterEmProducao('SUPER SUCO', 10000, 'ml', [
      [idAgua, 10000], [idLimaoTahiti, 600], [idAcucar, 600], [idAcidoCitrico, 480], [idAcidoMalico, 240], [idSal, 20],
    ]);
  }
  const idXaropeAcucar = query("SELECT id FROM insumos WHERE nome = 'XAROPE DE ACUCAR (SIMPLES)'")[0]?.id;
  if (idSucoTangerina && idVinagreMaca && idXaropeAcucar) {
    converterEmProducao('SHRUB DE TANGERINA CLEMENTINA', 870, 'ml', [
      [idSucoTangerina, 600], [idVinagreMaca, 70], [idXaropeAcucar, 200],
    ]);
  }
  if (idAbsolut && idChaDoAmor) {
    converterEmProducao('VODKA COM CHA DO AMOR (TALCHA)', 1000, 'ml', [
      [idAbsolut, 1000], [idChaDoAmor, 15],
    ]);
  }

  recalcAllProducoesInternas();
}
```

- [ ] **Step 2: Chamar a função dentro de `migrateSchema()`**

Em `db.js`, a função `migrateSchema()` (linha ~87-107 do arquivo atual) termina com `persist();`. Adicionar a chamada logo antes dessa linha:

```js
  db.run('UPDATE insumos SET estoque_atual = 0 WHERE estoque_atual IS NULL');
  seedProducaoPropria();
  persist();
}
```

(`seedProducaoPropria()` já persiste sozinha via `run`/`runInsert` a cada chamada — a `persist()` extra no fim de `migrateSchema()` não causa problema, só é redundante, mantém o padrão do resto da função.)

- [ ] **Step 3: Verificar num banco de teste que ainda não tem os revisar (no-op)**

Abrir o app com um banco novo (sem `localStorage` da chave `ficha_tecnica_bar_db_v1`) — `migrateSchema()` nem roda nesse caso (só roda pra banco existente), então não há nada a testar aqui além de confirmar que `init()` continua funcionando normalmente (a função nova só é chamada dentro de `migrateSchema()`, que só executa no branch de banco já salvo).

- [ ] **Step 4: Verificar num banco de teste que TEM os 4 revisar (caso real)**

Contra o banco que já tem as 14 fichas técnicas do Florest populadas (com os insumos revisar pelo nome exato), forçar a re-execução de `migrateSchema()` e checar o resultado via console do navegador:

```js
migrateSchema();
JSON.stringify({
  xarope: query("SELECT tipo, preco_compra, preco_unitario FROM insumos WHERE nome='XAROPE DE ACUCAR (SIMPLES)'")[0],
  superSuco: query("SELECT tipo, preco_compra FROM insumos WHERE nome='SUPER SUCO'")[0],
  shrub: query("SELECT tipo, preco_compra FROM insumos WHERE nome='SHRUB DE TANGERINA CLEMENTINA'")[0],
  vodkaCha: query("SELECT tipo, preco_compra FROM insumos WHERE nome='VODKA COM CHA DO AMOR (TALCHA)'")[0],
  itensXarope: query("SELECT COUNT(*) c FROM producao_itens WHERE producao_id = (SELECT id FROM insumos WHERE nome='XAROPE DE ACUCAR (SIMPLES)')")[0].c,
  itensShrub: query("SELECT COUNT(*) c FROM producao_itens WHERE producao_id = (SELECT id FROM insumos WHERE nome='SHRUB DE TANGERINA CLEMENTINA')")[0].c,
})
```

Expected: `xarope.tipo` = `"producao_interna"`, `xarope.preco_compra` = `2.59` (1000g açúcar × R$0,00259/g + 1000ml água × R$0, já que Água Filtrada é revisar), `xarope.preco_unitario` ≈ `0.001295` (2.59/2000); `superSuco.tipo` = `"producao_interna"`; `shrub.tipo` = `"producao_interna"` e `shrub.preco_compra` reflete o Xarope já convertido (encadeamento — inclui os 200g × 0,001295 do Xarope, o resto de Suco de Tangerina e Vinagre segue R$0/revisar exceto o Vinagre real); `vodkaCha.tipo` = `"producao_interna"`, `vodkaCha.preco_compra` = `1000×preco_unitario_absolut + 15×1.58` (depende do preço atual do Absolut no banco); `itensXarope` = `2`; `itensShrub` = `3`.

- [ ] **Step 5: Rodar `migrateSchema()` uma segunda vez e confirmar idempotência**

```js
const antes = { itensXarope: query("SELECT COUNT(*) c FROM producao_itens WHERE producao_id = (SELECT id FROM insumos WHERE nome='XAROPE DE ACUCAR (SIMPLES)')")[0].c };
migrateSchema();
const depois = { itensXarope: query("SELECT COUNT(*) c FROM producao_itens WHERE producao_id = (SELECT id FROM insumos WHERE nome='XAROPE DE ACUCAR (SIMPLES)')")[0].c };
JSON.stringify({ antes, depois, insumosDuplicados: query("SELECT COUNT(*) c FROM insumos WHERE nome='ACIDO CITRICO'")[0].c })
```

Expected: `antes.itensXarope === depois.itensXarope` (continua `2`, não duplicou), `insumosDuplicados` = `1` (não criou "ACIDO CITRICO" de novo).

- [ ] **Step 6: Rodar os testes de `model.test.js` pra garantir que nada quebrou**

Run: `cd ficha-tecnica-bar && node --test model.test.js`
Expected: 22 passing, 0 failing (nenhuma função pura de `model.js` foi tocada nesta task).

- [ ] **Step 7: Commit**

```bash
git add ficha-tecnica-bar/db.js
git commit -m "Add seedProducaoPropria migration: convert 4 revisar insumos to producao_interna"
```

---

### Task 2: Aba "Produções" — separar da aba Insumos

**Files:**
- Modify: `ficha-tecnica-bar/index.html` (nova aba/painel, mover botão)
- Modify: `ficha-tecnica-bar/render.js` (`renderInsumos()` filtra, nova `renderProducoes()`, `refreshAll()` chama a nova função)

**Interfaces:**
- Consumes: `getInsumos()` (model.js, já existe, retorna todos os tipos — filtro é feito no `render.js`, não no model), `openProducaoEditor(id)` (render.js, já existe, sem mudança), `fmtMoeda` (model.js, já existe).
- Produces: `renderProducoes()` — nova função em `render.js`, sem parâmetros, sem retorno (efeito colateral: popula `#producoes-list`). `refreshAll()` (já existe) passa a chamá-la.

- [ ] **Step 1: Adicionar a aba no `index.html`**

Na `<nav class="tabs">` (dentro de `.app-topbar`), depois do botão "Eventos":

```html
      <button class="tab-btn" data-tab="producoes">Produções</button>
```

- [ ] **Step 2: Mover o botão "+ Nova produção interna" pro painel novo**

No `<section id="tab-insumos">`, remover esta linha do toolbar:

```html
        <button id="btn-add-producao" class="btn secondary">+ Nova produção interna</button>
```

Depois da `</section>` que fecha `tab-eventos`, adicionar a nova seção (o `id="btn-add-producao"` é o mesmo de antes — `main.js` já tem o listener nele, não precisa mudar nada lá):

```html
    <section id="tab-producoes" class="tab-panel">
      <div class="toolbar">
        <span class="muted">Xaropes, infusões e preparos feitos na casa</span>
        <button id="btn-add-producao" class="btn">+ Nova produção interna</button>
      </div>
      <div id="producoes-list" class="receitas-grid"></div>
    </section>
```

- [ ] **Step 3: Filtrar `renderInsumos()` pra só mostrar comprados**

Em `render.js`, `renderInsumos()` começa com `const rows = getInsumos();`. Trocar por:

```js
  const rows = getInsumos().filter((r) => r.tipo !== 'producao_interna');
```

- [ ] **Step 4: Adicionar `renderProducoes()`**

Em `render.js`, logo depois de `renderEventos()`:

```js
function renderProducoes() {
  const rows = query("SELECT * FROM insumos WHERE tipo = 'producao_interna' ORDER BY nome");
  const list = document.getElementById('producoes-list');
  list.innerHTML = rows.map((r) => `
    <div class="receita-card" onclick="openProducaoEditor(${r.id})">
      <div class="receita-card-title">${escapeHtml(r.nome)}</div>
      <div class="receita-card-row"><span>Custo do lote</span><strong>${fmtMoeda(r.preco_compra)}</strong></div>
      <div class="receita-card-row"><span>Custo unitário</span><strong>${fmtMoeda(r.preco_unitario)} / ${r.unidade_compra}</strong></div>
      <div class="receita-card-row"><span>Categoria</span><strong>${escapeHtml(r.categoria || '-')}</strong></div>
    </div>
  `).join('') || '<p class="muted">Nenhuma produção interna cadastrada ainda.</p>';
}
```

- [ ] **Step 5: Chamar `renderProducoes()` em `refreshAll()`**

Em `render.js`, `refreshAll()` (topo do arquivo) ganha uma linha:

```js
function refreshAll() {
  renderInsumos();
  renderReceitas();
  renderDashboard();
  renderEventos();
  renderProducoes();
  if (state.editingReceitaId) renderReceitaEditorCampos();
  if (state.editingProducaoId) renderProducaoEditorCampos();
  if (state.editingEventoId) renderEventoEditorCampos();
}
```

- [ ] **Step 6: Verificar no navegador**

Abrir o app (banco já migrado pela Task 1), checar via console:

```js
JSON.stringify({
  insumosNaAbaInsumos: query("SELECT COUNT(*) c FROM insumos")[0].c - query("SELECT COUNT(*) c FROM insumos WHERE tipo='producao_interna'")[0].c,
  linhasNaTabelaInsumos: document.querySelectorAll('#insumos-tbody tr').length,
  producoesNoCard: document.querySelectorAll('#producoes-list .receita-card').length,
  producoesNoBanco: query("SELECT COUNT(*) c FROM insumos WHERE tipo='producao_interna'")[0].c,
})
```

Expected: `linhasNaTabelaInsumos === insumosNaAbaInsumos` (tabela de Insumos não mostra mais nenhum `producao_interna`); `producoesNoCard === producoesNoBanco` (todas as produções aparecem na aba nova). Clicar num card em "Produções" deve abrir o mesmo modal de edição de sempre (nenhuma mudança visual no editor).

- [ ] **Step 7: Rodar os testes**

Run: `cd ficha-tecnica-bar && node --test model.test.js`
Expected: 22 passing, 0 failing.

- [ ] **Step 8: Commit**

```bash
git add ficha-tecnica-bar/index.html ficha-tecnica-bar/render.js
git commit -m "Add Producoes tab, separate producao_interna insumos from Insumos grid"
```

---

## Depois das duas tasks

Rodar a migração (Task 1) contra o banco real de trabalho (o `.db` exportado hoje com as 14 fichas técnicas, ou o `localStorage` de onde o app é usado no dia a dia) e reexportar o `.db` atualizado — a migração só se aplica automaticamente da próxima vez que aquele banco específico for aberto no app (é isso que `migrateSchema()` faz em todo load).
