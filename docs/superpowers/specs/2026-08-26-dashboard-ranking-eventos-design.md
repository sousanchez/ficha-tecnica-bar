# Dashboard: comparação entre eventos (ranking de lucro) — design

## Contexto

Terceira frente do pedido original de mexer no Dashboard (ver histórico: 1-nova métrica, 2-ajustar receita mensal, 3-design/UX — a #3 já foi feita via ciclo de critique, ver specs de 2026-08-25/26). Esta spec cobre a #1: "comparação entre eventos", item que as specs anteriores (P0/P1/P2 do critique e a spec original de receita mensal) explicitamente listaram como fora de escopo — "Comparação entre eventos individuais (ranking de rentabilidade)".

Motivação: PRODUCT.md e o histórico de brainstorming (`docs/superpowers/specs/2026-08-21-kanban-pipeline-evento-design.md`) já mapeiam "dashboard financeiro consolidado" como um dos 7 subsistemas — receita mensal (feito) e CMV por receita (feito) cobrem parte disso; ranking de lucro por evento fecha a peça que faltava de "qual pacote deu mais lucro".

## Requisitos (do brainstorming)

- Ranquear por **lucro total do evento** (não margem %, não lucro por pessoa — descartados no brainstorming, ficam pra depois se fizer falta).
- **Só eventos `realizado`** — mesma regra já usada em "Receita mensal" (receita/lucro real, não projetado; `Confirmado` fica de fora).
- Ordem fixa: lucro decrescente. Não é sortável como as outras duas tabelas — é ranking por definição, não uma lista de dados neutros.
- Lucro com sinal visual: verde (`var(--good)`) se positivo, vermelho (`var(--bad)`) se negativo — texto simples, não badge (não é uma faixa como CMV, é só positivo/negativo).

## Modelo de dados

Nenhuma coluna nova. `getEventos()` (`model.js:302-304`) já retorna cada evento com `custoPorPessoa` pré-calculado. `calcTotaisEvento(custoPorPessoa, precoPacotePessoa, convidados)` (`model.js:360-364`) já existe e já é usada no editor de evento (`render.js:597`) — reaproveitada aqui, não duplicada.

## Funções novas (`model.js`)

```js
// Ranking de eventos por lucro total, decrescente. Recebe a lista ja
// filtrada pelo chamador (so 'realizado'), mesmo padrao de calcReceitaPorMes.
function calcRankingEventos(eventos) {
  return eventos
    .map((e) => ({ nome: e.nome, ...calcTotaisEvento(e.custoPorPessoa, e.preco_pacote_pessoa, e.convidados) }))
    .sort((a, b) => b.lucroTotal - a.lucroTotal);
}
```

Exportada no mesmo bloco `module.exports` que já exporta `calcReceitaPorMes`/`contarEventosSemData`.

## UI

### `index.html` — dentro de `#tab-dashboard`, depois da seção "Receita mensal"

```html
<div class="toolbar">
  <span>Comparação entre eventos (realizados)</span>
</div>
<div class="table-wrap">
  <table>
    <thead>
      <tr><th>Evento</th><th>Receita</th><th>Custo</th><th>Lucro</th></tr>
    </thead>
    <tbody id="dashboard-ranking-eventos-tbody"></tbody>
  </table>
</div>
```

### `render.js` — `renderDashboard()`, ao final da função

```js
const rankingEventos = calcRankingEventos(eventosRealizados);
const tbodyRanking = document.getElementById('dashboard-ranking-eventos-tbody');
tbodyRanking.innerHTML = rankingEventos.map((e) => `
    <tr>
      <td>${escapeHtml(e.nome)}</td>
      <td class="num">${fmtMoeda(e.receitaTotal)}</td>
      <td class="num">${fmtMoeda(e.custoTotal)}</td>
      <td class="num ${e.lucroTotal >= 0 ? 'lucro-pos' : 'lucro-neg'}">${fmtMoeda(e.lucroTotal)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="muted">Nenhum evento realizado ainda.</td></tr>';
```

`eventosRealizados` já existe na função (mesma variável usada por `calcReceitaPorMes`/`contarEventosSemData`) — reaproveitada, não recalculada.

### `style.css`

```css
.lucro-pos { color: var(--good); }
.lucro-neg { color: var(--bad); }
```

Mesmo vocabulário de cor já usado em `.cloud-status-ok`/`.cloud-status-error` (texto simples com cor semântica, sem pill) — não inventa tratamento novo.

## Casos de borda

- **Nenhum evento realizado** → "Nenhum evento realizado ainda." (mesma mensagem da tabela de receita mensal).
- **Evento realizado sem receitas vinculadas** → `custoPorPessoa = 0` (comportamento já existente de `calcCustoEventoPessoa`), `lucroTotal = receitaTotal` inteiro — sem tratamento especial necessário, a função já resolve.
- **Lucro exatamente zero** → conta como positivo (`>= 0` → verde), não neutro — decisão simples, evita um terceiro estado visual sem necessidade real.
- **Dois eventos com o mesmo lucro** → ordem entre eles é a que o `Array.sort` do JS resolver (estável, mantém ordem relativa original) — não precisa de critério de desempate explícito pra este volume de dados.

## Fora de escopo

- Margem % e lucro por pessoa como métrica de ranking (descartados no brainstorming).
- Incluir eventos `Confirmado` no ranking.
- Sort clicável nesta tabela (é ranking fixo, não filtro/ordenação livre).
- Qualquer mudança nas outras duas tabelas do Dashboard ou no editor de evento.

## Testes

- **Unit**: `calcRankingEventos` — lista vazia → `[]`; um evento → uma linha; dois eventos, ordena por lucro decrescente; evento com lucro negativo (custo > receita) aparece corretamente, sem quebrar o sort; evento sem receitas vinculadas (`custoPorPessoa = 0`) → lucro = receita total.
- **Manual no navegador**: com eventos reais marcados como `Realizado`, conferir que a tabela aparece ordenada por lucro, cores verde/vermelho corretas, e que eventos `Confirmado` não entram.
