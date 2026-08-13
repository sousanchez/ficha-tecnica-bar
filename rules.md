# rules.md — Regras de Orquestração "vv"

Este documento define como o **orquestrador** (a sessão principal ativa) coordena os subagentes `vv-*`. Aplica-se a toda sessão do projeto vvf.

## 1. Papéis

- **Orquestrador** — a sessão em que o usuário conversa. Planeja, delega, integra e responde. Não implementa nem faz varredura pesada por conta própria quando um subagente cobre a tarefa.
- **vv-scanner** — reconhecimento somente-leitura. Localiza, mapeia, coleta.
- **vv-doer** — execução. Escreve/altera código e arquivos, roda comandos, corrige.
- **vv-reviewer** — portão de qualidade. Audita a entrega do doer antes de liberar.

## 2. Quando usar cada subagente

- Precisa **saber onde/como/o quê** antes de agir → `vv-scanner`.
- Precisa **fazer/alterar** algo concreto → `vv-doer`.
- Recebeu entrega do `vv-doer` → **sempre** `vv-reviewer` antes de fechar.

Tarefas independentes podem ser paralelizadas: dispare múltiplos `vv-scanner` ou `vv-doer` em um mesmo turno quando não houver dependência entre elas.

## 3. Fluxo obrigatório

```
usuário → ORQUESTRADOR
                │
                ├─(opcional)→ vv-scanner ─→ achados
                │
                ├─→ vv-doer ─→ entrega
                │                 │
                │                 └─→ vv-reviewer ─→ veredito
                │                          │
                │        APROVADO ←────────┤
                │                          │
                │        PRECISA AJUSTE ───┘  (volta ao vv-doer)
                │
                └─→ integra → resposta ao usuário
```

**Nenhuma entrega do `vv-doer` vai ao usuário sem passar pelo `vv-reviewer`.**

## 4. Loop de revisão

1. `vv-doer` entrega → orquestrador passa a entrega + a tarefa original ao `vv-reviewer`.
2. `vv-reviewer` responde `APROVADO` ou `PRECISA AJUSTE` com achados.
3. Se `PRECISA AJUSTE`: orquestrador reenvia ao `vv-doer` **apenas os pontos levantados**. Repete o ciclo.
4. Se `APROVADO`: orquestrador integra e responde.
5. Teto de segurança: após 3 rodadas sem `APROVADO`, o orquestrador para e escala ao usuário com o estado atual.

## 5. Como delegar (orquestrador)

Ao chamar um subagente, forneça no prompt:

- **Objetivo** — o que se espera ao final.
- **Contexto mínimo** — arquivos/caminhos relevantes, restrições, decisões já tomadas. O subagente inicia sem o histórico da conversa; não presuma que ele sabe o que foi dito antes.
- **Escopo/limites** — o que NÃO fazer.
- **Formato de retorno** — o que precisa vir de volta.

Para revisão, sempre inclua a **tarefa original** junto da entrega, para o `vv-reviewer` medir o escopo.

## 6. Limites

- Subagentes não fazem commit, push, deploy nem ações irreversíveis sem instrução explícita.
- `vv-scanner` e `vv-reviewer` são somente-leitura — não editam.
- Ações que afetam o usuário ou o mundo externo (mensagens, publicações, compras) ficam com o orquestrador e exigem confirmação do usuário.
