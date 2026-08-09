# CLAUDE.md

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
