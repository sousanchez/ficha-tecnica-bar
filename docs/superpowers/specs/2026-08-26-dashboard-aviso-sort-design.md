# Dashboard: aviso de dado incompleto + sort/scroll — design

## Contexto

P2 do critique de UX do Dashboard (2026-08-25, snapshot `.impeccable/critique/2026-08-25T17-20-00Z__ficha-tecnica-bar-index-html-tab-dashboard.md`, score 17/40). P0 (preço de venda + CMV, commit `4b65f22`) e P1 (linhas clicáveis + resumo, commit `835ec98`) já saíram. Restam dois achados P2, cobertos juntos nesta spec por serem pequenos e tocarem as mesmas duas tabelas:

1. **"Receita mensal" descarta silenciosamente eventos `realizado` sem `data`** — `calcReceitaPorMes` (model.js) faz `if (!e.data) return;` sem contador nem aviso. Risco de verdade financeira (contradiz Princípio 1 do PRODUCT.md: "Cost truth over convenience").
2. **Sem sort/paginação, agravado por 195 receitas já cadastradas** (confirmado por evidência de navegador real do critique) — "Custo por receita" renderiza tudo de uma vez, vira scroll longo já no primeiro load.

## Requisitos (do shape)

### Aviso de dado incompleto
- Nova função pura `contarEventosSemData(eventos)` em `model.js` — conta eventos sem `data` na lista passada.
- `calcReceitaPorMes` **não muda** (contrato/testes existentes preservados).
- Nota visível abaixo da tabela "Receita mensal", só quando a contagem for > 0: "N evento(s) realizado(s) sem data, não incluído(s) na soma."

### Sort + tabela rolável
- **Não é paginação.** O app já resolve "tabela grande" em Insumos (224+ linhas) com `table-wrap` de altura limitada + header sticky (`style.css:162-163,168` — `#tab-insumos .table-wrap { max-height: calc(100vh - 190px) }`, `th { position: sticky; top: 0 }` já é regra global). "Custo por receita" reaproveita esse padrão exato — não inventa paginação, que não tem precedente no app.
- Headers sortáveis usam `<button>` real dentro do `<th>` — acessibilidade de teclado vem de graça do elemento nativo, sem precisar do `tabindex`/`role`/`onkeydown` manual que as linhas do P1 precisaram (não podiam ser `<button>` porque são linhas inteiras de `<tr>`; headers podem).
- "Custo por receita": sort por Receita (nome), Custo, CMV. Clique alterna asc/desc na mesma coluna; clique em coluna diferente reseta pra asc.
- "Receita mensal": sort por Mês, Receita — mesmo mecanismo. `mes` já vem como string `'YYYY-MM'` (`fmtMesAno` só formata na exibição) — ordena certo como string, sem parse de data.
- CMV nulo (receita sem preço definido) sempre ordena por último, nas duas direções — não some no meio da lista dependendo do sentido do sort.
- Estado de sort é só de UI, efêmero, não persiste — mesmo espírito de `state.eventosView` (toggle Lista/Kanban já existente).

## Fora de escopo

- Paginação de verdade (página 1/2/3...) — o padrão escolhido é scroll limitado, não paginação.
- Filtro por categoria.
- Total row na "Custo por receita" — já coberto pelo tile "Custo total" do P1 (`dash-custo-total`).
- Qualquer mudança nas abas Insumos/Eventos/Produções, mesmo reaproveitando o padrão visual delas.

## Funções novas (`model.js`)

```js
// Quantos eventos da lista passada nao tem data preenchida.
// Espera a lista ja filtrada pelo chamador (mesmo padrao de calcReceitaPorMes:
// recebe so 'realizado', nao filtra estagio aqui).
function contarEventosSemData(eventos) {
  return eventos.filter((e) => !e.data).length;
}
```

Exportada no mesmo bloco `module.exports` que já exporta `calcReceitaPorMes`/`fmtMesAno`.

## UI

### `index.html` — "Receita mensal" (dentro de `#tab-dashboard`)

Elemento novo depois do `.table-wrap` da tabela, escondido por padrão:

```html
<p id="dashboard-aviso-sem-data" class="muted" style="display:none;"></p>
```

### `index.html` — headers sortáveis

Cada `<th>` sortável vira:

```html
<th><button class="th-sort" data-table="custo" data-field="nome">Receita</button></th>
```

(`data-table`/`data-field` identificam qual sort state atualizar; nome exato dos campos a decidir na implementação, seguindo o padrão acima pra nome/custo/cmv na tabela de custo e mes/receita na tabela mensal.)

### `index.html` — table-wrap de "Custo por receita"

Ganha um id próprio (ex: `id="dashboard-custo-wrap"`) pra CSS scoped, mesmo mecanismo de `#tab-insumos .table-wrap`.

### `style.css`

Regra nova, mesma família de `#tab-insumos .table-wrap` (`style.css:162-163`), aplicada só ao wrap da tabela "Custo por receita" — ajustar o valor de `max-height` levando em conta que o Dashboard agora também tem a linha de indicadores (P1) acima da tabela, então o cálculo `calc(100vh - Npx)` não é necessariamente o mesmo N do Insumos; medir/ajustar durante a implementação.

`.th-sort` — botão sem decoração extra (herda tipografia de `th`), cursor pointer, indicador visual de direção ativa (ex: `▲`/`▼` só na coluna atualmente ordenada) — reaproveitar o vocabulário visual já existente (Bar Brass pra estado ativo, mesmo uso de `.tab-btn.active`), não introduzir cor nova.

### `render.js` — `renderDashboard()`

- Ordena `receitas` e `receitaPorMes` conforme `state` de sort (novo, ex: `state.dashboardSortCusto = { field: 'nome', dir: 'asc' }` e `state.dashboardSortMensal = { field: 'mes', dir: 'asc' }`) antes de montar as linhas — default de cada um reproduz a ordem atual (nome alfabético / mês cronológico), então sem sort explícito o comportamento não muda.
- Compara CMV com null-safe: nulo sempre por último, independente de `dir`.
- Calcula `contarEventosSemData(eventosRealizados)` e mostra/esconde `#dashboard-aviso-sem-data` com a mensagem formatada.

### `main.js`

Wiring de clique nos `.th-sort` (delegação de evento ou binding direto, seguindo o padrão já usado pros outros controles de UI do app) — lê `data-table`/`data-field`, atualiza o `state` de sort correspondente (toggle de direção se mesmo campo, senão reset pra asc), chama `refreshAll()` (ou só `renderDashboard()`, o que for consistente com o padrão existente).

## Casos de borda

- **Nenhum evento sem data** → aviso fica escondido (`display:none`), não aparece um "0 eventos sem data" irrelevante.
- **Lista de receitas vazia** → sort não quebra (`[].sort()` é no-op).
- **Todas as receitas com CMV nulo** → sort por CMV não muda a ordem relativa entre elas (todas empatam no "por último"), mantém estável.
- **Clique repetido na mesma coluna** → alterna asc/desc infinitamente, sem terceiro estado "sem sort" depois do primeiro clique (simplicidade > flexibilidade aqui).

## Testes

- **Unit**: `contarEventosSemData` — lista vazia → `0`; nenhum sem data → `0`; mix → conta certo; todos sem data → tamanho da lista.
- **Manual no navegador**: marcar um evento `realizado` sem data, conferir aviso aparecendo com contagem certa; reverter ao final. Clicar cada header sortável, conferir ordenação e alternância asc/desc, inclusive com receitas sem preço (CMV nulo) sempre por último. Conferir que "Custo por receita" rola dentro do próprio wrap sem estourar a altura da página, com header sticky visível durante o scroll.
