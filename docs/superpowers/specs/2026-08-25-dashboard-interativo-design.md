# Dashboard interativo (linhas clicáveis + resumo) — design

## Contexto

P1 do critique de UX do Dashboard (2026-08-25, snapshot `.impeccable/critique/2026-08-25T17-20-00Z__ficha-tecnica-bar-index-html-tab-dashboard.md`, score 17/40): a aba Dashboard é o único lugar do app onde nenhuma linha/card é clicável — `.receita-card` (`render.js:149`), cards de evento e de produção abrem editor ao clicar, as `<tr>` de `renderDashboard()` não. E nenhum componente "resposta computada" (`.indicador`, já usado em `index.html:139-141,244-248`) aparece na única aba chamada Dashboard.

P0 (preço de venda + CMV por receita, commit `4b65f22`) já saiu — este P1 usa o `preco_venda`/`cmv` que o P0 deixou disponível.

## Requisitos (do shape)

- Linhas de "Custo por receita" clicáveis → `openReceitaEditor(r.id)`, mesmo destino de `.receita-card`, mas com `tabindex="0"` + `role="button"` + handler de teclado (Enter/Espaço) — o `.receita-card` não tem isso hoje (zero `tabindex`/`role="button"` em `index.html` inteiro); esta spec não repete o bug, e não conserta o `.receita-card` existente (fora de escopo).
- "Receita mensal" **não** fica clicável — linha é agregado por mês, sem entidade única de destino.
- Nova linha `.indicadores` no topo de `#tab-dashboard`, antes das duas tabelas, 4 tiles: Custo total, CMV médio (só receitas com `preco_venda > 0`), Receitas sem preço definido (contagem), Receita realizada total.

## Fora de escopo

- Quadrante menu-engineering — bloqueado por `vendas_periodo` (pendência já adiada no CLAUDE.md).
- "# receitas abaixo da margem alvo" — bloqueado por `markup_alvo` (idem).
- Sort/paginação das tabelas — P2, spec separada.
- Aviso de evento `realizado` sem `data` — P2, spec separada.
- Qualquer mudança em `.receita-card` ou nos cards de evento/produção.

## Funções novas (`model.js`)

```js
// CMV medio entre as receitas que tem preco de venda definido (>0).
// Receitas sem preco (cmv null) ficam de fora da media, nao contam como 0.
function calcCmvMedio(receitas) {
  const comPreco = receitas
    .map((r) => calcIndicadores(r.custo, r.preco_venda).cmv)
    .filter((cmv) => cmv !== null);
  if (comPreco.length === 0) return null;
  return comPreco.reduce((s, v) => s + v, 0) / comPreco.length;
}

// Quantas receitas ainda nao tem preco de venda definido.
function calcReceitasSemPreco(receitas) {
  return receitas.filter((r) => !r.preco_venda || r.preco_venda <= 0).length;
}
```

Exportadas no mesmo bloco `module.exports` que já exporta `calcReceitaPorMes`/`fmtMesAno`.

## UI

### `index.html` — dentro de `#tab-dashboard`, antes do primeiro `.toolbar` (`index.html:71`)

```html
<div class="indicadores">
  <div class="indicador"><span>Custo total</span><strong id="dash-custo-total">R$ 0,00</strong></div>
  <div class="indicador"><span>CMV médio</span><strong id="dash-cmv-medio" class="badge">-</strong></div>
  <div class="indicador"><span>Receitas sem preço</span><strong id="dash-sem-preco">0</strong></div>
  <div class="indicador"><span>Receita realizada</span><strong id="dash-receita-realizada">R$ 0,00</strong></div>
</div>
```

### `render.js` — `renderDashboard()`

Linha da tabela "Custo por receita" ganha atributos de interação e handler:

```js
return `
  <tr class="row-clickable" tabindex="0" role="button"
      onclick="openReceitaEditor(${r.id})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openReceitaEditor(${r.id})}">
    <td>${escapeHtml(r.nome)}</td>
    <td class="num">${fmtMoeda(r.custo)}</td>
    <td class="num"><span class="badge ${cmvClass(cmv)}">${cmvIcon(cmv)}${fmtPct(cmv)}</span></td>
  </tr>
`;
```

Cálculo dos 4 tiles, uma vez por `renderDashboard()`, antes das duas tabelas:

```js
document.getElementById('dash-custo-total').textContent = fmtMoeda(receitas.reduce((s, r) => s + r.custo, 0));
const cmvMedio = calcCmvMedio(receitas);
const cmvMedioEl = document.getElementById('dash-cmv-medio');
cmvMedioEl.textContent = fmtPct(cmvMedio);
cmvMedioEl.className = 'badge ' + cmvClass(cmvMedio);
document.getElementById('dash-sem-preco').textContent = calcReceitasSemPreco(receitas);
document.getElementById('dash-receita-realizada').textContent = fmtMoeda(receitaPorMes.reduce((s, r) => s + r.receita, 0));
```

`receitaPorMes` já existe na função (variável usada pela tabela "Receita mensal") — reaproveitar, não recalcular.

### `style.css`

`.row-clickable` — cursor pointer + mesmo hover-border-Bar-Brass do `.receita-card` (`style.css`, procurar a regra `.receita-card:hover` durante a implementação e espelhar em `tr.row-clickable:hover`), mais um outline visível em `:focus-visible` (novo — nem `.receita-card` tem foco visível hoje; esta linha deve ter, por ser a única interação com teclado do app até agora).

## Casos de borda

- **Nenhuma receita com preço definido** → `calcCmvMedio` retorna `null` → tile mostra `-` (mesmo tratamento de `cmvClass(null)`/`fmtPct(null)` já usado em outros lugares).
- **Lista de receitas vazia** → `calcCmvMedio([])` retorna `null`, `calcReceitasSemPreco([])` retorna `0`, custo total `R$ 0,00` — sem erro.
- **Clique/Enter/Espaço na linha não deve disparar duas vezes** — só um listener por linha (`onclick` cobre mouse, `onkeydown` cobre teclado; não há sobreposição porque são eventos diferentes).

## Testes

- **Unit**: `calcCmvMedio` — lista vazia → `null`; todas sem preço → `null`; mix (algumas com preço, outras não) → média só das precificadas; todas com preço → média simples. `calcReceitasSemPreco` — vazia → `0`; todas sem preço → `N`; mix → conta certo; `preco_venda` negativo (não deveria ocorrer, mas o input não impede) → conta como "sem preço".
- **Manual no navegador**: clicar uma linha da tabela "Custo por receita" abre o editor da receita certa; Tab até uma linha e apertar Enter/Espaço faz o mesmo; os 4 tiles batem com os dados reais (custo total, CMV médio, contagem sem preço, receita realizada somada).
