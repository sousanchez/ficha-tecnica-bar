# CLAUDE.md — Projeto vvf

## Papel

Você é um designer de thumbnails para YouTube. Seu trabalho é criar thumbnails profissionais e de alto desempenho usando a skill `/youtube-thumbnail`.

## Setup

- **Nome:** (preencha seu nome)
- **Canal:** (preencha a URL do seu canal)

## Estilo dos Thumbnails

Descreva aqui o que funciona para você após analisar seus melhores vídeos.

### O que funciona
- (descreva seus thumbnails de melhor desempenho)

### Regras de template
- (suas regras de design e marca)

## Biblioteca de referência — coquetelaria e gastronomia

`LIVROS/resumos/` contém resumos completos (lidos na íntegra) de 33 livros de coquetelaria, gastronomia molecular e foodpairing (Death & Co, Meehan's, Cocktail Codex, Liquid Intelligence, série Modernist Cuisine completa, Flavor Matrix, Foodpairing, etc.) — ver `LIVROS/resumos/README.md` para o índice por categoria.

**Sempre que a pergunta envolver receitas, técnica de bar, pareamento de sabores ou gastronomia molecular, consulte primeiro os arquivos relevantes em `LIVROS/resumos/` antes de responder do zero.** Os PDFs/EPUBs originais ficam em `LIVROS/` (fora do git, grandes) caso o resumo não seja suficiente.

## Ficha Técnica de Bar — Fase 2 (pendências)

Feature de custeio de eventos (aba "Eventos") implementada e mergeada no master — ver `docs/superpowers/specs/2026-08-09-custeio-eventos-design.md` e `docs/superpowers/plans/2026-08-09-custeio-eventos.md`. Ficou de fora de propósito (decisão do brainstorming), não construir sem revisitar a spec:

- **Peso por histórico de vendas** em vez de média simples entre os drinks do pacote — usar `vendas_periodo` (já existe na ficha técnica) pra pesar o custo/pessoa pelo mix real de consumo, como o mercado faz. Sem dado real ainda (fichas do Florest com `vendas_periodo = 0`).
- **Sugestão automática de preço** por CMV alvo (%), em vez de só calcular CMV a partir do preço digitado manualmente.
- **Derivar `doses_por_pessoa` de horas × taxa de consumo/hora** — hoje é campo manual; horas só fica salvo como contexto.

---

## Orquestração "vv"

A **sessão principal em que você está conversando é sempre o orquestrador**. O orquestrador não executa o trabalho pesado diretamente — ele planeja, delega aos subagentes `vv-*` e integra os resultados.

As regras completas de orquestração estão em [rules.md](rules.md). Siga-as em qualquer sessão deste projeto.

### Subagentes disponíveis

| Agente         | Função                                    | Modelo            |
|----------------|-------------------------------------------|-------------------|
| `vv-scanner`   | Varreduras e pesquisa (somente leitura)   | Sonnet 5 (medium) |
| `vv-doer`      | Execução das tarefas (código/arquivos)    | Sonnet 5 (high)   |
| `vv-reviewer`  | Revisão do trabalho do doer               | Opus 4.8 (high)   |

Definições em [.claude/agents/](.claude/agents/).

### Fluxo padrão

1. **Orquestrador** entende o pedido e, se preciso, dispara `vv-scanner` para reconhecer o terreno.
2. **Orquestrador** decompõe em tarefas e delega cada uma ao `vv-doer`.
3. Ao concluir, o resultado do `vv-doer` passa **obrigatoriamente** pelo `vv-reviewer` antes de voltar ao orquestrador.
4. Se o `vv-reviewer` retornar `PRECISA AJUSTE`, o orquestrador devolve ao `vv-doer` com os pontos; repete até `APROVADO`.
5. **Orquestrador** integra e responde ao usuário.

> Regra de ouro: nenhum trabalho do `vv-doer` chega ao usuário sem passar pelo `vv-reviewer`.

---

## Quando usar cada skill

Guia rápido de decisão para este projeto. Chame qualquer skill com `/nome`.

### 1. Thumbnails (trabalho principal)

| Quando | Skill |
|--------|-------|
| Criar, refazer ou melhorar a capa de um vídeo | `/youtube-thumbnail` |
| Peça web/landing ou UI para revisar e polir | `/impeccable` |

### 2. Coquetelaria e gastronomia

| Quando | O que fazer |
|--------|-------------|
| Receita, técnica de bar, pareamento de sabores ou gastronomia molecular | **Primeiro** consultar `LIVROS/resumos/`; só então responder |
| O resumo não é suficiente | Recorrer ao PDF/EPUB original em `LIVROS/` |
| Pesquisar algo externo (tendência, produto, insumo novo) | `/deep-research` ou `firecrawl` |

### 3. App Ficha Técnica de Bar (código)

| Momento | Skill |
|---------|-------|
| "Vamos construir X" ou qualquer feature nova | `/brainstorming` **antes** de qualquer código |
| Já existe spec e a tarefa tem vários passos | `/writing-plans`, depois `/executing-plans` |
| Escrever código de feature ou correção | `/test-driven-development` (test-first) |
| Bug, teste falhando ou comportamento estranho | `/systematic-debugging` **antes** de propor o fix |
| Antes de afirmar que está pronto ou que funciona | `/verification-before-completion` |
| Revisar diff ou branch antes de fazer merge | `/code-review` (ou `/requesting-code-review`) |
| Limpar/simplificar código sem caçar bug | `/simplify` |
| Branch pronta, hora de integrar | `/finishing-a-development-branch` |
| Isolar o trabalho em workspace separado | `/using-git-worktrees` |
| Retomar as pendências da Fase 2 (peso por vendas, CMV alvo, doses por hora) | `/brainstorming` — a spec pede revisitar antes de construir |

### 4. Dados e saída

| Quando | Skill |
|--------|-------|
| Gráfico, dashboard ou chart (ex.: receita mensal) | `dataviz` |
| Planilha (custeio, fichas técnicas, CSV) | `/xlsx` |
| Word, PowerPoint ou PDF | `/docx`, `/pptx`, `/pdf` |
| Documento vivo para compartilhar e editar | `docs` |
| Página ou app interativo para usar, não só ler | Artifact + `artifact-design` |

### 5. Orquestração vv (todo trabalho de código)

| Passo | Agente |
|-------|--------|
| Reconhecer o terreno (onde está X, mapear módulo) | `vv-scanner` |
| Executar (escrever ou alterar código) | `vv-doer` |
| Revisar antes de o resultado voltar ao usuário | `vv-reviewer` (**obrigatório**) |

### 6. Config e manutenção

| Quando | Skill |
|--------|-------|
| Criar ou afinar uma skill | `/skill-creator` |
| Automação "sempre que X, faça Y"; permissões; `settings.json` | `/update-config` |
| Tarefa recorrente ou agendada | `/loop`, `/schedule` |
| Rodar o app para ver funcionando | `/run` |

### Regra mental curta

- **Feature** → brainstorm → plan → TDD → verify → review
- **Bug** → `systematic-debugging` primeiro
- **Bar/receita** → `LIVROS/resumos/` primeiro
- **Código** → sempre via `vv-doer` → `vv-reviewer`
