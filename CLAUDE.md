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
