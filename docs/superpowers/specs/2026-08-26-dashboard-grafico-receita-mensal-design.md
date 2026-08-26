# Dashboard: gráfico de barras pra receita mensal — design

## Contexto

Última das 3 frentes do pedido original de mexer no Dashboard (1-nova métrica ✅ `33f44eb`, 2-esta, 3-design/UX ✅ ciclo de critique). A spec original de "Receita mensal" (2026-08-25) descartou gráfico explicitamente ("Gráfico de barras — tabela simples foi a escolha"); esta spec revisita essa decisão a pedido do usuário, adicionando visualização sem remover a tabela.

Segue o procedimento da skill `dataviz`: forma pela função do dado (mudança ao longo do tempo, série única) → cor por último, computada não "no olho".

## Requisitos (do brainstorming)

- **Forma:** gráfico de barras verticais (coluna) — mês no eixo X, receita no eixo Y. Série única, sem necessidade de legenda (o toolbar "Receita mensal" já nomeia).
- **Cor:** neutra — preenchimento Slate Panel (`var(--panel-2)`) + borda Graphite Border (`var(--border)`), topo arredondado reaproveitando `rounded.sm` (6px, já em `style.css`). Sem cor nova introduzida, sem violar "Bar Brass raro"/"Focus Blue só foco/Enigma" do DESIGN.md.
- **Rótulo:** valor exato (`fmtMoeda`) sempre visível acima de cada barra — desvio deliberado da regra padrão da skill ("nunca um número em cada ponto"): justificado porque no máximo 12 barras cabem aqui (agrupamento por mês) e o Princípio 1 do PRODUCT.md ("cost truth over convenience") pesa mais que economia visual nesta ferramenta. Sem hover/tooltip — seria redundante com o rótulo já sempre visível.
- **Ordem cronológica sempre**, independente do sort que a tabela abaixo já tem (`state.dashboardSortMensal` — feature existente, não mexe). O gráfico existe pra ler tendência ao longo do tempo; inverter a ordem dele conforme o usuário ordena a tabela por receita quebraria essa leitura.
- **Tabela existente continua** logo abaixo do gráfico, sem nenhuma mudança de comportamento — serve de "table view" (requisito de acessibilidade da skill `dataviz`, já satisfeito de graça por já existir).
- **Vazio:** sem eventos realizados → gráfico não renderiza nada (nem barras nem "sem dados" redundante) — só a tabela por baixo mostra a mensagem de vazio que já existe.

## Cuidado de implementação (bug real a evitar)

`receitaPorMes.sort(...)` (linha ~210 de `render.js`, dentro de `renderDashboard()`) **muta o array in-place** pra aplicar o sort da tabela. Se o gráfico ler essa mesma variável depois do `.sort()`, herda a ordem escolhida pelo usuário na tabela em vez de cronológica. **Capturar uma cópia pro gráfico ANTES da linha do sort**, ex:

```js
const receitaPorMes = calcReceitaPorMes(eventosRealizados);
const receitaPorMesCronologica = [...receitaPorMes]; // copia antes do sort mutar o array da tabela
const sortMensal = state.dashboardSortMensal;
receitaPorMes.sort((a, b) => compararParaSort(a[sortMensal.field], b[sortMensal.field], sortMensal.dir));
```

`calcReceitaPorMes` já devolve os meses em ordem cronológica (`Object.keys(porMes).sort()`, YYYY-MM ordena certo como string) — a cópia não precisa de nenhum sort adicional, só existir antes da mutação.

## Funções novas

Nenhuma em `model.js` — cálculo de altura de barra é puramente de apresentação (normalização por valor máximo da série), fica em `render.js` mesmo, sem necessidade de função pura testável separada (não há regra de negócio aqui, só proporção geométrica).

## UI

### `index.html` — dentro da seção "Receita mensal" (depois do `.toolbar` de `index.html:94-96`, antes do `.table-wrap` da tabela em `index.html:97`)

```html
<div id="dashboard-chart-receita-mensal" class="chart-barras"></div>
```

### `render.js` — dentro de `renderDashboard()`, logo após capturar `receitaPorMesCronologica` (ver seção "Cuidado de implementação" acima)

```js
const chartEl = document.getElementById('dashboard-chart-receita-mensal');
const maxReceita = Math.max(...receitaPorMesCronologica.map((r) => r.receita), 0.01); // evita divisao por zero se tudo for 0
chartEl.innerHTML = receitaPorMesCronologica.map((r) => {
  const alturaPct = Math.max((r.receita / maxReceita) * 100, 2); // minimo 2% de altura pra barra de valor zero nao sumir
  return `
    <div class="chart-barra-col">
      <div class="chart-barra-valor">${fmtMoeda(r.receita)}</div>
      <div class="chart-barra" style="height: ${alturaPct}%"></div>
      <div class="chart-barra-label">${fmtMesAno(r.mes)}</div>
    </div>
  `;
}).join('');
```

Se `receitaPorMesCronologica` estiver vazio, `.map().join('')` já resolve pra string vazia — `chartEl` fica sem filhos, nada renderiza, sem checagem extra necessária.

### `style.css`

```css
.chart-barras {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 160px;
  padding: 8px 0 0;
}
.chart-barra-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
}
.chart-barra-valor {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  margin-bottom: 4px;
}
.chart-barra {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px 6px 0 0;
  min-height: 2px;
}
.chart-barra-label {
  font-size: 11px;
  color: var(--muted);
  margin-top: 6px;
  white-space: nowrap;
}
```

(valores exatos de espaçamento/altura são ponto de partida — ajustar durante a implementação se não couber bem com 12 meses lado a lado dentro da largura de `.table-wrap`/coluna do Dashboard; manter os tokens de cor/radius exatamente como especificado, isso não é negociável).

## Casos de borda

- **Nenhum evento realizado** → `receitaPorMesCronologica` vazio, gráfico não renderiza nada, tabela abaixo mostra sua própria mensagem de vazio (já existente, sem mudança).
- **Um único mês com receita** → uma barra só, `maxReceita` = valor desse mês, barra ocupa 100% da altura — sem divisão por zero (guarda `Math.max(..., 0.01)` já cobre esse e o caso de receita zerada).
- **Mês com receita exatamente 0** (evento realizado com `preco_pacote_pessoa = 0` ou `convidados = 0`) → barra com altura mínima de 2% (visível como traço fino na base), não some do gráfico — mantém a leitura de "esse mês existe, mas não gerou receita".
- **12 meses simultâneos** (ano cheio) → `flex: 1` em cada coluna distribui a largura igualmente; testar visualmente se os rótulos de mês/valor não colidem nesse volume.

## Fora de escopo

- Hover/tooltip (redundante com rótulo sempre visível, decisão já justificada acima).
- Filtro de período/intervalo de datas no gráfico.
- Comparação ano-a-ano ou qualquer segunda série (é uma métrica única, um eixo).
- Remover ou alterar a tabela "Receita mensal" existente, seu sort, ou o aviso de eventos sem data.
- Gráficos em qualquer outra seção do Dashboard (Custo por receita, Comparação entre eventos).

## Testes

- **Unit**: nenhuma função pura nova — nada a adicionar em `model.test.js`.
- **Manual no navegador**: com eventos reais marcados como `Realizado` em meses diferentes, conferir que o gráfico aparece acima da tabela, barras em ordem cronológica (não muda se a tabela for ordenada por receita), valores dos rótulos batem com a tabela logo abaixo, barra de mês com receita zero ainda aparece (traço fino), gráfico não renderiza nada quando não há evento realizado algum.
