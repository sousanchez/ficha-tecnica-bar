# Kanban pipeline evento — design

## Contexto

A aba Eventos (`ficha-tecnica-bar/`) já cadastra pacotes (nome, convidados, doses/pessoa, preço, custo/pessoa, CMV) numa lista de cards, mas não tem noção de estágio comercial — não dá pra ver de relance quais eventos são só lead, quais já têm proposta enviada, quais estão confirmados ou já aconteceram.

Motivação: inspirado no pipeline Kanban de eventos do produto Bar Plan Pro (bar-plus.pro), adaptado ao uso interno de Vale Verde Festas (single-owner, sem multi-tenant, sem cobrança de terceiros — ver `PRODUCT.md`). Primeiro de 7 subsistemas mapeados a partir da comparação com Bar Plan Pro; os outros 6 (proposta PDF, contrato automático, cobrança PIX, envio WhatsApp, lista de compras do evento, dashboard financeiro consolidado) ficam para ciclos de brainstorming separados.

## Requisitos (do brainstorming)

- 4 estágios: **Lead → Proposta → Confirmado → Realizado**.
- Troca de estágio via **dropdown** no card (não drag-and-drop).
- Trocar estágio **só grava o valor novo** — sem data de transição, sem trava de edição pós-Realizado (fica para depois se fizer falta).
- Kanban é **visualização alternativa** à lista atual, com toggle Lista/Kanban — não substitui a lista existente.
- Eventos já cadastrados (sem coluna `estagio`) ganham **Lead** como estágio inicial quando a coluna for criada.

## Modelo de dados

Uma coluna nova em `eventos`, adicionada em `migrateSchema()` (`db.js`), mesmo padrão de `addColIfMissing` já usado para as outras colunas novas do app:

```js
addColIfMissing('eventos', "estagio TEXT DEFAULT 'lead'");
```

`ALTER TABLE ... ADD COLUMN ... DEFAULT 'lead'` aplica o default também às linhas já existentes — cobre a decisão de migração sem passo manual extra.

Valores válidos (fechados, sem constraint CHECK no schema — a UI restringe via `<select>`, mesmo padrão de outros campos do app que não usam CHECK):
- `lead`
- `proposta`
- `confirmado`
- `realizado`

## Funções novas (`model.js`)

- Constante `ESTAGIOS_EVENTO`:
  ```js
  const ESTAGIOS_EVENTO = [
    { valor: 'lead', label: 'Lead' },
    { valor: 'proposta', label: 'Proposta' },
    { valor: 'confirmado', label: 'Confirmado' },
    { valor: 'realizado', label: 'Realizado' },
  ];
  ```
  Exportada no mesmo bloco de `module.exports` que já exporta `calcIndicadores`/`computeMenuEngineering`, para o front consumir.
- `updateEventoField` (já existe) ganha `'estagio'` na whitelist `allowed` (linha `const allowed = ['nome', 'data', 'convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa']`). Nenhuma função de transição nova — trocar estágio é a mesma chamada `updateEventoField(id, 'estagio', valor)` que os outros campos já usam via `setField`.
- `addEvento()` (já existe): INSERT não precisa listar `estagio` — a coluna pega `DEFAULT 'lead'` automaticamente por omissão no INSERT.

## UI

- Toggle "Lista / Kanban" no topo do painel da aba Eventos, dois botões no mesmo estilo visual de `.tab-btn`. Controla `state.eventosView` (`'lista'` | `'kanban'`), default `'lista'`, **não persiste** entre reloads (estado de UI efêmero, não é dado de negócio).
- `renderEventosKanban()` nova em `render.js`:
  - 4 colunas, uma por item de `ESTAGIOS_EVENTO`, na ordem Lead/Proposta/Confirmado/Realizado.
  - Cada coluna lista os eventos daquele `estagio` como `.receita-card` (reaproveita a classe/estilo já usado no card de lista — mesmos campos: nome, convidados, custo/pessoa, badge CMV).
  - Cada card ganha um `<select>` de estágio (opções = `ESTAGIOS_EVENTO`, selecionado = `e.estagio`). `onchange` chama `updateEventoField(e.id, 'estagio', this.value)` seguido de `refreshAll()`. `onclick` do `<select>` chama `event.stopPropagation()` para não disparar o `onclick` do card (que abre `openEventoEditor`).
- `renderEventos()` (lista, já existe) fica sem mudança de lógica interna — só passa a ser mostrado/ocultado conforme `state.eventosView`, mesmo mecanismo de `.tab-panel`/`.active` já usado entre abas.
- `refreshAll()` passa a chamar a view ativa da aba Eventos (lista ou kanban) em vez de só `renderEventos()`.
- Wiring dos botões de toggle em `main.js`, mesmo padrão de binding de outros controles de UI do app.

## Casos de borda

- **Coluna do Kanban sem nenhum evento** naquele estágio → fica vazia, sem placeholder especial (mesmo tratamento visual da lista vazia hoje, ver `'<p class="muted">Nenhum evento cadastrado ainda.</p>'`).
- **Evento novo criado** → nasce em `Lead` (via `DEFAULT`), aparece na coluna Lead do Kanban e também na lista, sem passo extra.
- **Clique no `<select>` de estágio dentro do card** → não deve abrir o editor do evento (`stopPropagation`).

## Testes

- Sem teste unitário novo — não há função pura nova, só uma coluna de dado e uma constante de opções (sem lógica de cálculo a testar).
- Manual no navegador: criar evento de teste, avançar pelas 4 opções no `<select>` do Kanban, conferir que o card se move de coluna e que a lista (ao trocar o toggle) mostra o mesmo estágio; confirmar que abrir um banco salvo antes desta mudança traz os eventos existentes já em "Lead"; apagar o registro de teste no fim.

## Fora de escopo (fica para os outros 6 subsistemas mapeados)

- Data/timestamp de quando o evento mudou de estágio.
- Trava de edição para eventos em estágio "Realizado".
- Proposta PDF, contrato automático, cobrança PIX, envio WhatsApp, lista de compras do evento, dashboard financeiro consolidado — cada um com seu próprio ciclo de brainstorming.
