# Dashboard: polimento pós re-critique — design

## Contexto

Re-critique da aba Dashboard (2026-08-26, snapshot `.impeccable/critique/2026-08-26T20-51-37Z__ficha-tecnica-bar-index-html-tab-dashboard.md`, score 27/40, subiu de 17/40) confirmou que P0/P1/P2 anteriores (commits `4b65f22`, `835ec98`, `9b5c5c1`) são fixes reais, não maquiagem. Restaram 3 achados pequenos (2×P2, 1×P3) mais um P2 já fora de escopo (menu-engineering, bloqueado por `vendas_periodo` zerado — pendência conhecida do CLAUDE.md, não tocado nesta spec).

## Requisitos (do shape)

### 1) Ícone no badge "CMV médio"
`#dash-cmv-medio` é o único badge da aba sem o ícone (`✓`/`!`/`✕`) que todo outro badge de CMV usa — quebra a regra do DESIGN.md ("status must never ride on color alone") justamente no número de maior destaque da tela.

### 2) Anel de foco da linha clicável
`tr.row-clickable:focus-visible` usa Bar Brass 2px; todo outro elemento focável do app (inputs/selects/textareas) usa Focus Blue 1px, que o DESIGN.md chama de "o único tratamento de foco do sistema". Alinhar.

### 3) Tile "Receitas sem preço" vira toggle-filtro
Hoje é um `<div class="indicador">` inerte — mostra a contagem mas não leva a lugar nenhum. Vira botão-toggle: clique filtra "Custo por receita" só pras receitas com `preco_venda <= 0`; clique de novo remove o filtro. Estado visual "ativo" reaproveita o padrão de `.tab-btn.active`/`.eventos-view-btn.active` já existente.

**Decisão explícita:** não mexe no sort/`compararParaSort` — "CMV nulo sempre por último, nas duas direções" foi decisão deliberada do P2 anterior (comentário em `render.js:156-157`), não é o mecanismo certo pra "achar as sem preço" porque nunca traz elas pro topo. O filtro é a solução, não o sort.

## Fora de escopo

- Menu-engineering / quadrante Estrela-Cavalo-Enigma-Abacaxi (bloqueado por `vendas_periodo`, pendência já conhecida).
- Busca/filtro por nome na tabela de custo (achado menor do re-critique, não pedido nesta rodada).
- Qualquer mudança em `compararParaSort`/sort existente.

## Funções alteradas

Nenhuma função pura nova em `model.js`. Tudo é estado de UI + render, mesmo padrão de `state.eventosView`.

### `render.js`

```js
// dentro de renderDashboard(), no bloco dos 4 tiles:
const cmvMedioEl = document.getElementById('dash-cmv-medio');
cmvMedioEl.textContent = cmvIcon(cmvMedio) + fmtPct(cmvMedio);
cmvMedioEl.className = 'badge ' + cmvClass(cmvMedio);
```

Filtro aplicado antes do sort/render da tabela "Custo por receita": se `state.dashboardFiltroSemPreco` for `true`, `receitas` (já com `.cmv` calculado) é filtrada pra `r.preco_venda <= 0` antes de passar por `compararParaSort`/render. Tile de contagem (`#dash-sem-preco`) continua mostrando a contagem total de receitas sem preço, independente do filtro estar ativo ou não (a contagem é sobre todas as receitas, o filtro é sobre o que a tabela exibe).

Estado vazio da tabela filtrada e sem resultado (todas já precificadas) usa mensagem própria: "Todas as receitas já têm preço definido." — distinta do "Nenhuma ficha tecnica cadastrada ainda." genérico (esse é pra lista vazia de verdade, não pra filtro sem resultado).

### `main.js`

Novo estado: `dashboardFiltroSemPreco: false` (mesmo bloco de `dashboardSortCusto`/`dashboardSortMensal`).

Listener de clique no tile (`#dash-sem-preco` ou no `.indicador` que o envolve — decidir durante a implementação qual elemento recebe o `onclick`, mas precisa ter `cursor:pointer` visível pra sinalizar que é clicável, diferente dos outros 3 tiles que continuam inertes):

```js
document.getElementById('dash-sem-preco-tile').addEventListener('click', () => {
  state.dashboardFiltroSemPreco = !state.dashboardFiltroSemPreco;
  renderDashboard();
});
```

(nome exato do id/seletor a confirmar durante a implementação, seguindo o padrão de `index.html` atual)

### `index.html`

Tile "Receitas sem preço" ganha um id no `.indicador` container (não só no `<strong>`) pra poder aplicar `cursor:pointer` e a classe de "ativo", e um atributo `role="button"`/`tabindex="0"` seguindo o mesmo raciocínio de acessibilidade já usado nas linhas clicáveis (`row-clickable`) — mas usando o padrão correto desta vez: se for viável usar um `<button>` real envolvendo o conteúdo do tile (como os headers sortáveis já fazem), preferir isso à alternativa manual de tabindex/role, pelo mesmo motivo já registrado na spec anterior (acessibilidade nativa de graça).

### `style.css`

```css
tr.row-clickable:focus-visible {
  outline: 1px solid var(--accent-2);
  outline-offset: -1px;
}
```

(troca a regra existente, não adiciona uma nova — `outline-offset: -1px` mantido ou ajustado conforme o valor atual já usado para inputs, checar `style.css:115` durante a implementação pra bater exatamente com o padrão).

Novo estado visual "filtro ativo" no tile de "Receitas sem preço" — reaproveitar a mesma lógica de cor/borda que `.tab-btn.active`/`.eventos-view-btn.active` já usam (Bar Brass), não inventar tratamento novo.

## Casos de borda

- **Filtro ativo + todas as receitas já precificadas** → tabela mostra "Todas as receitas já têm preço definido." em vez do genérico "Nenhuma ficha tecnica cadastrada ainda.".
- **Filtro ativo + sort aplicado** → os dois convivem: filtra primeiro, ordena o resultado filtrado depois (mesmo `compararParaSort`, sem mudança).
- **CMV médio nulo (nenhuma receita precificada)** → `cmvIcon(null)` já retorna `''` (função existente, sem mudança) — badge mostra só `-`, sem ícone quebrado.

## Testes

- **Unit**: nenhuma função pura nova — nada a testar em `model.test.js` além do que já existe.
- **Manual no navegador**: CMV médio mostra ícone certo (✓/!/✕) conforme a faixa; Tab até uma linha da tabela mostra anel de foco azul (Focus Blue), não dourado; clicar o tile "Receitas sem preço" filtra a tabela, clicar de novo remove o filtro; com todas as receitas precificadas (cenário hipotético), filtro ativo mostra a mensagem de vazio correta.
