# Preço de venda e CMV por receita — design

## Contexto

Critique de UX/design da aba Dashboard (`docs/superpowers/specs` não existe ainda para o critique em si — snapshot salvo em `.impeccable/critique/2026-08-25T17-20-00Z__ficha-tecnica-bar-index-html-tab-dashboard.md`) achou o problema raiz por trás do Dashboard não mostrar CMV/margem por receita, como PRODUCT.md promete ("Review a dashboard comparing CMV and margin across recipes"): a coluna `receitas.preco_venda` existe no schema e já é inserida em `addReceita()` (`model.js:228-229`), mas **não existe campo de input em lugar nenhum do editor de receita**, nem entra no draft de edição (`abrirRascunhoDaReceita`, `render.js:364-368`).

O comentário em `render.js:358-359` já antecipava isso — "renderReceitaEditorComputados() só atualiza as áreas derivadas (custo/**CMV**/preço sugerido/tabela de itens)" — ou seja, CMV no editor de receita já era esperado, só nunca foi construído. `calcIndicadores(custo, precoVenda)` (`model.js:260-264`) já existe genérica e correta — hoje só é chamada com dado de evento (`ev-custo-pessoa`/`ev-preco-pacote-pessoa`), nunca com dado de receita.

Prioridade P0 do critique de 2026-08-25 (score 17/40, aba Dashboard). Sem isso, qualquer melhoria visual no Dashboard (P1/P2 do mesmo critique) fica decorativa — não há CMV real pra mostrar.

## Requisitos (do shape)

- Campo **Preço de venda** editável no modal de edição de receita, mesmo padrão de input de `ev-preco-pacote-pessoa` (`index.html:237`: `type="number" step="0.01"`).
- CMV, Markup e Margem calculados **ao vivo** a partir desse preço e do custo já calculado (`re-custo`), reaproveitando `calcIndicadores` — mesmo padrão visual do bloco `.indicadores` do editor de evento (`index.html:244-248`: badge com `cmvClass`/`cmvIcon`).
- Persistência segue o contrato de save já existente do editor de receita (draft explícito + botão Salvar — **não** autosave, diferente do editor de evento).
- Tabela "Custo por receita" do Dashboard (`render.js:159-164`) ganha coluna **CMV**, badge reaproveitado (`cmvClass`/`cmvIcon`/`fmtPct`, já usados em `render.js:188,209`).

## Fora de escopo (decisão já registrada, não revisitar sem motivo novo)

- **Sugestão automática de preço por CMV alvo** (`markup_alvo`, já existe na tabela) — pendência explicitamente adiada em `CLAUDE.md` ("Fase 2 — pendências").
- **Peso por histórico de vendas** (`vendas_periodo`) — idem, mesma pendência do CLAUDE.md.
- Linha `.indicador`/quadrante de métricas na própria aba Dashboard (P1 do critique — spec separada).
- Sort/paginação nas tabelas do Dashboard, aviso de evento sem `data` (P2 do critique — specs separadas).

## Modelo de dados

Nenhuma coluna nova — `receitas.preco_venda` já existe (`db.js`, já inserida com default `0` em `addReceita()`, `model.js:228-229`).

## Funções alteradas (`model.js`)

```js
function updateReceitaField(id, field, value) {
  const allowed = ['nome', 'categoria', 'modo_preparo', 'copo', 'guarnicao', 'tempo_preparo', 'rendimento', 'preco_venda'];
  setField('receitas', allowed, id, field, value);
}
```

`calcIndicadores`, `cmvClass`, `cmvIcon`, `fmtPct`, `fmtMoeda` — nenhuma mudança, só reuso.

## UI

### `index.html` — modal de receita (dentro de `.form-grid`, `index.html:131-137`)

```html
<label>Preço de venda <input id="re-preco-venda" type="number" step="0.01"></label>
```

Novo bloco `.indicadores` logo após o existente (`index.html:139-141`):

```html
<div class="indicadores">
  <div class="indicador"><span>CMV</span><strong id="re-cmv" class="badge">-</strong></div>
  <div class="indicador"><span>Markup</span><strong id="re-markup">-</strong></div>
  <div class="indicador"><span>Margem</span><strong id="re-margem">R$ 0,00</strong></div>
</div>
```

### `index.html` — tabela "Custo por receita" do Dashboard (`index.html:76-84`)

Novo `<th>CMV</th>` depois de `<th>Custo</th>`.

### `render.js` — draft e cálculo (`abrirRascunhoDaReceita`, `render.js:362-370`)

`state.receitaDraft` ganha `preco_venda: r.preco_venda ?? 0`.

### `render.js` — `renderReceitaEditorCampos()` (`render.js:389-406`)

Repovoa `re-preco-venda.value` a partir do draft, mesmo padrão dos outros campos do form-grid (linha ~392-398). Handler de input em `main.js` (mesmo padrão dos outros campos do draft) grava no draft e chama `renderReceitaEditorComputados()`.

### `render.js` — `renderReceitaEditorComputados()` (`render.js:407+`)

Depois do cálculo de `custo` existente:

```js
const { cmv, markup, margem } = calcIndicadores(custo, d.preco_venda);
const cmvEl = document.getElementById('re-cmv');
cmvEl.textContent = cmvIcon(cmv) + fmtPct(cmv);
cmvEl.className = `badge ${cmvClass(cmv)}`;
document.getElementById('re-markup').textContent = markup === null ? '-' : markup.toFixed(2) + 'x';
document.getElementById('re-margem').textContent = fmtMoeda(margem);
```

### `render.js` — save da receita

Persistir `preco_venda` junto do save do draft, mesmo mecanismo que já grava os outros campos do form-grid ao clicar Salvar (localizar a função de save real durante o plano — não confirmado nesta spec qual função grava o draft inteiro vs. campo a campo).

### `render.js` — `renderDashboard()` (`render.js:156-165`)

```js
const cmv = calcIndicadores(r.custo, r.preco_venda).cmv;
```
adicionar `<td class="badge ${cmvClass(cmv)}">${cmvIcon(cmv)}${fmtPct(cmv)}</td>` na linha da tabela.

## Casos de borda

- **`preco_venda = 0` (default)** → `calcIndicadores` já retorna `cmv: null, markup: null` → badge mostra `-` (mesmo comportamento já testado hoje pra evento sem preço).
- **Receita sem nenhum insumo (`custo = 0`)** com `preco_venda > 0` → `markup: null` (custo > 0 é a guarda existente em `calcIndicadores`), `margem = preco_venda` — comportamento já correto na função existente, sem mudança necessária.

## Testes

- **Unit**: cobertura de `calcIndicadores`/`cmvClass`/`cmvIcon`/`fmtPct` já existe (reuso, não precisa de teste novo de lógica pura).
- **Manual no navegador**: abrir uma receita existente, digitar preço de venda, conferir CMV/markup/margem atualizando ao vivo; salvar; reabrir e conferir persistência; conferir coluna CMV aparecendo na tabela do Dashboard pra essa receita.
