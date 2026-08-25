# Dashboard financeiro (receita mensal) — design

## Contexto

A aba Dashboard (`ficha-tecnica-bar/`) hoje só mostra "Custo por receita" — uma tabela de custo por ficha técnica, sem nenhuma visão financeira ligada aos eventos (pacotes) cadastrados na aba Eventos.

Motivação: segundo subsistema mapeado a partir da comparação com Bar Plan Pro (bar-plus.pro) — ver `docs/superpowers/specs/2026-08-21-kanban-pipeline-evento-design.md` para o mapeamento original dos 7 subsistemas. Este cobre "dashboard financeiro consolidado", com escopo restrito ao que o brainstorming decidiu: evolução de receita por mês, não o dashboard completo (comparação entre eventos e lucro/margem ficam de fora por ora).

## Requisitos (do brainstorming)

- Métrica: **receita total** por período (não lucro, não margem — fica pra depois se fizer falta).
- Granularidade: **por mês**, agrupando pela data do evento.
- Filtro: **só eventos com `estagio === 'realizado'`** — receita real, não projetada (Confirmado fica de fora).
- Formato: **tabela simples** (mês | receita), sem gráfico.
- Local: **nova seção dentro da aba Dashboard já existente**, abaixo da tabela "Custo por receita".

## Modelo de dados

Nenhuma coluna nova. Usa campos já existentes em `eventos`: `data` (input `type="date"`, formato ISO `YYYY-MM-DD` — confirmado em `index.html:218`), `preco_pacote_pessoa`, `convidados`, `estagio`.

## Funções novas (`model.js`)

```js
// Soma preco_pacote_pessoa x convidados por mes (YYYY-MM da data do evento).
// Funcao pura - recebe a lista de eventos ja filtrada pelo chamador (so
// 'realizado'), mesmo padrao de calcCustoEventoPessoa/computeMenuEngineering.
function calcReceitaPorMes(eventos) {
  const porMes = {};
  eventos.forEach((e) => {
    if (!e.data) return; // sem data, nao da pra agrupar por mes
    const mes = e.data.slice(0, 7); // 'YYYY-MM'
    const receita = e.preco_pacote_pessoa * e.convidados;
    porMes[mes] = (porMes[mes] || 0) + receita;
  });
  return Object.keys(porMes).sort().map((mes) => ({ mes, receita: porMes[mes] }));
}

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
// 'YYYY-MM' -> 'Mes/AAAA' (pt-BR, sem lib externa - mesma restricao do resto do app)
function fmtMesAno(mesStr) {
  const [ano, mes] = mesStr.split('-');
  return `${NOMES_MES[parseInt(mes, 10) - 1]}/${ano}`;
}
```

Ambas exportadas no bloco `module.exports` de `model.js`, junto das demais funções puras (mesmo padrão de `calcCustoEventoPessoa`/`ESTAGIOS_EVENTO`).

Evento `realizado` sem `data` preenchida é ignorado pela agregação (não aparece em nenhum mês) — não é um bug a esconder, é o comportamento esperado dado que não há como agrupar sem data.

## UI

- `index.html`: dentro de `#tab-dashboard` (`index.html:70-86`), depois do `</div>` que fecha o `table-wrap` da tabela "Custo por receita", nova seção:
  ```html
  <div class="toolbar">
    <span>Receita mensal (eventos realizados)</span>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Mês</th>
          <th>Receita</th>
        </tr>
      </thead>
      <tbody id="dashboard-receita-mensal-tbody"></tbody>
    </table>
  </div>
  ```
- `render.js`: `renderDashboard()` (linha 156) ganha, ao final, a segunda tabela:
  ```js
  const eventosRealizados = getEventos().filter((e) => e.estagio === 'realizado');
  const receitaPorMes = calcReceitaPorMes(eventosRealizados);
  const tbodyMensal = document.getElementById('dashboard-receita-mensal-tbody');
  tbodyMensal.innerHTML = receitaPorMes.map((r) => `
      <tr>
        <td>${fmtMesAno(r.mes)}</td>
        <td class="num">${fmtMoeda(r.receita)}</td>
      </tr>
    `).join('') || '<tr><td colspan="2" class="muted">Nenhum evento realizado ainda.</td></tr>';
  ```
  `fmtMoeda` já existe e já é usado na primeira tabela desta mesma função — reaproveitado, não duplicado.

## Casos de borda

- **Nenhum evento `realizado`** → tabela mostra "Nenhum evento realizado ainda." (mesmo padrão de placeholder das outras tabelas/listas do app).
- **Evento `realizado` sem `data`** → excluído da soma silenciosamente (não há "mês" pra agrupar); não gera linha "mês desconhecido" nem erro.
- **`preco_pacote_pessoa` ou `convidados` zerados** → contribuem 0 pro mês (comportamento correto, não precisa de tratamento especial — multiplicação por zero já resolve).
- **Dois eventos realizados no mesmo mês** → soma na mesma linha (é exatamente o propósito do agrupamento).

## Testes

- **Unit (`node --test`)**: `calcReceitaPorMes` — lista vazia → `[]`; um evento com data → uma linha; dois eventos no mesmo mês → soma; dois eventos em meses diferentes → duas linhas ordenadas; evento sem `data` → ignorado. `fmtMesAno` — converte `'2026-08'` → `'Agosto/2026'` corretamente (índice de mês certo, incluindo janeiro/dezembro como casos de borda de índice).
- **Manual no navegador**: com os eventos reais já cadastrados (hoje ambos em `Confirmado`), marcar um como `Realizado` com uma data preenchida, conferir que a tabela de receita mensal mostra a linha correta; reverter o estágio de volta a `Confirmado` ao final pra não alterar o estado real do usuário.

## Fora de escopo (fica pra depois, se fizer falta)

- Lucro e margem % por mês (métrica escolhida no brainstorming foi só receita).
- Comparação entre eventos individuais (ranking de rentabilidade).
- Gráfico de barras (tabela simples foi a escolha).
- Incluir eventos `Confirmado` na soma (só `Realizado` entra).
