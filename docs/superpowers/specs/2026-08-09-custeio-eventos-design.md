# Custeio de eventos (pacotes) — design

## Contexto

O app Ficha Técnica de Bar (`ficha-tecnica-bar/`) já custeia drinks individuais (1 dose por ficha técnica). Falta uma forma de responder: "dado um cardápio de drinks + N convidados + duração do evento, quanto custa por pessoa e que preço cobrar no pacote?"

Motivação real: o lançamento Florest (300 convidados, 14 fichas técnicas já cadastradas) precisa virar um pacote precificável, e essa mesma mecânica deve servir pra qualquer evento futuro da Vale Verde Festas — não é cálculo pontual.

## Requisitos (do brainstorming)

- Reusável pra qualquer evento futuro, não só o Florest.
- Ficha técnica continua sempre por 1 dose (não vira batch/lista de compras) — o cálculo de evento é uma camada em cima, não uma mudança na ficha técnica.
- Consumo por pessoa = **N doses por pessoa**, livre entre os drinks do pacote (confirma padrão de mercado: pesquisa mostrou que open bar profissional usa doses/pessoa/hora × duração — ver Sources abaixo).
- Duração do evento em horas é um campo do pacote, salvo e exibido, mas **não alimenta fórmula nenhuma** — `doses_por_pessoa` é digitado direto pelo usuário. Horas fica como contexto/referência (ajuda a decidir quantas doses/pessoa faz sentido, olhando o padrão de mercado de doses/hora), não como cálculo automático. Derivar `doses_por_pessoa` de horas × taxa fica pra fase 2 se fizer falta.
- Peso entre os drinks selecionados: **média simples** por enquanto. Peso por histórico de vendas (`vendas_periodo`, que a ficha técnica já tem) é padrão de mercado real (pesquisa confirmou: empresas pesam pelo mix de vendas dos últimos 90 dias) mas fica pra fase 2 — hoje as fichas do Florest têm `vendas_periodo = 0` (sem histórico ainda), então não haveria dado real pra pesar agora.
- O pacote/evento fica **salvo** (nome, revisitável, não é calculadora descartável).
- Preço do pacote por pessoa é **digitado manualmente** pelo usuário, e o app calcula CMV/margem a partir disso — mesmo padrão já usado nas fichas técnicas individuais (`calcIndicadores`), sem sugestão automática de preço.

## Modelo de dados

Duas tabelas novas em `db.js` (`SCHEMA_SQL`), mesmo padrão relacional de `receitas`/`receita_itens`:

```sql
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  data TEXT DEFAULT '',
  convidados INTEGER DEFAULT 0,
  horas REAL DEFAULT 0,
  doses_por_pessoa REAL DEFAULT 0,
  preco_pacote_pessoa REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS evento_receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  receita_id INTEGER NOT NULL REFERENCES receitas(id)
);
```

`CREATE TABLE IF NOT EXISTS` já roda em todo load do banco (novo ou existente, ver `db.js:init`), então essas tabelas aparecem automaticamente em bancos já salvos sem precisar de passo extra em `migrateSchema()` — que só existe hoje pra `ALTER TABLE` (adicionar coluna em tabela já existente).

`evento_receitas` não guarda quantidade: peso é igual entre os drinks selecionados (decisão do brainstorming). Adicionar peso por histórico depois é só somar uma coluna nessa tabela ou usar `vendas_periodo` na hora do cálculo — não exige mudança de schema hoje.

## Cálculo

Função pura, testável sem banco vivo (mesmo padrão aplicado em `computeMenuEngineering` nesta sessão — recebe dado como parâmetro em vez de buscar do banco internamente):

```js
function calcCustoEventoPessoa(custosDasReceitas, dosesPorPessoa) {
  if (!custosDasReceitas.length) return 0;
  const mediaCusto = custosDasReceitas.reduce((s, c) => s + c, 0) / custosDasReceitas.length;
  return mediaCusto * dosesPorPessoa;
}
```

Wrapper que busca do banco:

```js
function calcCustoEvento(eventoId) {
  const custos = query(
    `SELECT r.id FROM evento_receitas er JOIN receitas r ON r.id = er.receita_id WHERE er.evento_id = ?`,
    [eventoId]
  ).map((r) => calcCustoReceita(r.id));
  const doses = query('SELECT doses_por_pessoa FROM eventos WHERE id = ?', [eventoId])[0]?.doses_por_pessoa ?? 0;
  return calcCustoEventoPessoa(custos, doses);
}
```

CMV/margem do pacote reusa `calcIndicadores(custoPorPessoa, precoPacotePessoa)` — já existe, nenhuma função nova pra isso.

## Funções novas (`model.js`)

Mesmo padrão das funções de receita já existentes:

- `getEventos()` — lista todos, com custo/pessoa calculado
- `getEvento(id)` — evento + lista de receitas selecionadas (nome, custo)
- `addEvento()` — insere linha em branco, abre editor
- `updateEventoField(id, field, value)` — via `setField('eventos', allowed, id, field, value)` (helper já criado nesta sessão pro fix #3 do code review)
- `deleteEvento(id)` — `ON DELETE CASCADE` em `evento_receitas.evento_id` limpa os vínculos sozinho
- `addEventoReceita(eventoId, receitaId)` / `removeEventoReceita(id)` — toggle de drink no pacote
- `calcCustoEventoPessoa(custosDasReceitas, dosesPorPessoa)` — função pura (ver acima)
- `calcCustoEvento(eventoId)` — wrapper que busca do banco (ver acima)

## UI

- Nova aba "Eventos" em `index.html` (tab-btn + tab-panel), ao lado de Insumos/Fichas Técnicas/Dashboard
- `renderEventos()` em `render.js` — cards (nome, convidados, custo/pessoa, badge CMV), mesmo padrão de `renderReceitas()`
- `renderEventoEditor()` — modal com: nome, data, convidados, horas, doses/pessoa, preço do pacote/pessoa, checklist de fichas técnicas ativas (marcar/desmarcar pra incluir no pacote), custo/pessoa e CMV/margem calculados. Mecânica idêntica ao modal de produção interna que já existe.
- Wiring em `main.js` — mesmo padrão de `bindFormFields`/handlers já usado nos outros modais.

## Casos de borda

- **Evento sem nenhum drink selecionado** → `calcCustoEventoPessoa` retorna 0 (lista vazia tratada explicitamente, sem NaN); UI mostra "Selecione ao menos 1 drink" em vez de custo zerado sem explicação.
- **Apagar uma receita usada em algum evento** → hoje `deleteReceita` não tem esse guard (só existe pra `deleteInsumo`). Vai precisar replicar: bloquear delete com aviso se a receita estiver em algum `evento_receitas`, senão o evento fica com custo errado silenciosamente (JOIN simplesmente não traz mais aquele item).
- **`doses_por_pessoa` / `convidados` vazios ou não numéricos** → mesmo tratamento que os outros campos numéricos do app (`parseFloat(...) || 0`).
- **`preco_pacote_pessoa = 0`** (não preenchido ainda) → `calcIndicadores` já trata isso graciosamente (cmv null, markup 0 se custo>0), mesmo comportamento das fichas individuais hoje.

## Testes

- **Unit (`node --test`)**: `calcCustoEventoPessoa` — lista vazia → 0, 1 item, média de vários itens, escala correta por `doses_por_pessoa`. Mesma abordagem dos testes já existentes pra `calcIndicadores`/`computeMenuEngineering`.
- **Manual no navegador**: criar evento de teste, marcar/desmarcar drinks, conferir custo/pessoa e CMV batem com a conta manual, apagar o registro de teste, confirmar que sobrevive a reload. Mesmo rigor aplicado ao fluxo 1 desta sessão — sempre em cima do dado real do app, criando e limpando registro temporário, nunca mexendo no que já existe.

## Fora de escopo (fase 2, não construir agora)

- Peso por histórico de vendas (`vendas_periodo`) em vez de média simples.
- Sugestão automática de preço por CMV alvo.
- Derivar `doses_por_pessoa` automaticamente a partir de horas × taxa de consumo/hora.
- Lista de compras / batch em L/kg a partir do evento (esse era o entendimento inicial errado do pedido — o real é custo/pessoa pra precificar pacote, não lista de compras).

## Sources (pesquisa de mercado que embasou as decisões acima)

- [Open Bar Packages 101](https://barmastersmobilebartending.com/barmasters-blog/open-bar-packages-guide/)
- [Calculating the Cost of an Open Bar for Your Wedding](https://curatedevents.com/blog/how-much-does-an-open-bar-at-a-wedding-cost/)
- [Saiba como calcular a quantidade de bebidas do seu open bar](https://recantoinspiracao.com.br/saiba-como-calcular-a-quantidade-de-bebidas-do-seu-open-bar/)
- [Calculo de bebidas para evento – Bartender Store](https://bartenderstore.com.br/calculo-de-bebidas-para-evento/)
- [Bar Pour Cost & Beverage Margin Guide](https://www.tableview.com/blog/bar-pour-cost/)
- [Mixer Calculator for Events](https://barmastersmobilebartending.com/barmasters-blog/mixer-calculator-for-events/)
