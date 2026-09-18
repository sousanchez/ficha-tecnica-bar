---
tags: [projeto, vale-verde, cardapio, app]
---

# App — Cardápio Vale Verde

Projeto de código que apresenta o [[cardapio-autoral]] como site. Evolução do protótipo em HTML único (`folha-degustacao-coqueteis.html`) para uma estrutura real: componentes reutilizáveis e **dados dos drinks separados do layout**, para editar receita e citação sem mexer no visual.

- **Localização:** `C:\Claude\vale-verde` (fora deste vault; o vault guarda só a documentação).
- **Stack:** Vite + React + TypeScript.

## Rodar

```bash
cd C:\Claude\vale-verde
npm install
npm run dev      # http://localhost:5173
npm run build    # build de produção
```

## Onde editar

- **Receita/citação de um drink:** apenas o arquivo do espaço em `src/data/` (`florest.ts`, `acqua.ts`, `serra.ts`, `basico.ts`). Nada de layout.
- **Adicionar drink:** novo objeto no array `drinks` do espaço.
- **Adicionar espaço:** criar `src/data/<espaco>.ts` e incluí-lo em `spaces` no `src/data/index.ts`.
- **Carta-postal (visual):** `src/components/DrinkCard.tsx` + `src/styles/card.css`.

## Estado dos dados (espelha o vault)

- **Florest:** fichas fechadas (fonte canônica: [[cardapio-evento-florest]]); citações reais em [[citacoes-cardapio-autoral]].
- **Acqua / Serra dos Cristais:** tudo `[SUGESTÃO]`, citação pendente ([[acqua-cartas]], [[serra-cartas]]).
- Brix/ABV/pH: campo `specs` fica ausente até o bar medir — não estimar.

## Ver também

- [[cardapio-autoral]]
- [[florest-cartas]]
