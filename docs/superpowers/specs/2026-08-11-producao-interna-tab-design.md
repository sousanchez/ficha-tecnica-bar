# Aba "Produções" + custeio real das produções da casa — design

## Contexto

Ao popular as 14 fichas técnicas do Florest (ver `docs/cardapio-evento-florest.md` e `docs/clareira.md`), vários ingredientes ficaram como insumo "comprado" com preço 0 (badge "revisar") por não terem preço de fornecedor confiável: Vodka com Chá do Amor (Talchá), Chá do Amor concentrado, Shrub de tangerina clementina, Xarope de açúcar simples, Super Suco. Nenhum desses é comprado pronto — são preparados na própria casa a partir de outros insumos, o que é exatamente o caso de uso da feature "Produção interna" que já existe no app (`tipo='producao_interna'` em `insumos`, tabela `producao_itens`, `recalcProducaoBase`/`recalcAllProducoesInternas` com encadeamento em `model.js`).

Hoje produção interna não tem uma área própria: os insumos desse tipo ficam misturados nas 253 linhas da tabela de Insumos, diferenciados só por uma badge "Produção" e um ícone de editar. Pedido do usuário: uma aba dedicada só pra esses.

## Requisitos

- Nova aba **"Produções"** no menu principal (junto de Insumos/Fichas Técnicas/Dashboard/Eventos), listando só insumos com `tipo='producao_interna'`.
- Aba Insumos passa a mostrar só `tipo='comprado'` — produção interna sai de lá.
- Botão "+ Nova produção interna" muda do toolbar de Insumos pro toolbar da nova aba.
- Editor de produção interna **não muda** — reaproveita o modal e a lógica de rascunho+Salvar já existentes (`abrirRascunhoDaProducao`, `renderProducaoEditorCampos/Computados`, `salvarProducao`).
- 4 dos 5 insumos "revisar" viram produção interna de verdade, com sub-receita calculada a partir de outros insumos (tabela completa abaixo). O 5º (Chá do Amor concentrado sem álcool) fica como está — proporção ainda não definida pelo usuário.
- Conversão comprado→produção interna dos 4 itens é feita **uma vez, direto no banco** (script único via `run()`/`runInsert()`, sem adicionar função nova no app pra isso) — mantém o mesmo `id` de insumo, então as fichas técnicas que já apontam pra eles continuam funcionando sem edição.

## Aba "Produções" — arquitetura

Mesmo padrão visual e de código das abas Fichas Técnicas / Eventos (card-grid + modal), sem elemento novo de UI a inventar:

- `index.html`: novo `<button class="tab-btn" data-tab="producoes">Produções</button>` na nav; novo `<section id="tab-producoes" class="tab-panel">` com toolbar (`+ Nova produção interna`) + `<div id="producoes-list" class="receitas-grid">`.
- `render.js`:
  - `renderInsumos()` — query passa a filtrar `WHERE tipo = 'comprado'` (hoje traz tudo).
  - Nova `renderProducoes()` — mesma estrutura de `renderReceitas()`: busca `getInsumos()` filtrando `tipo = 'producao_interna'`, monta um card por item (nome, custo total do lote, custo unitário, categoria), `onclick` abre `openProducaoEditor(id)` (já existe, sem mudança).
  - `refreshAll()` passa a chamar `renderProducoes()` também.
- `main.js`: `attachGlobalHandlers` — o listener de `btn-add-producao` (hoje no toolbar de Insumos) muda de lugar no HTML, o handler em si (`addProducaoInterna`) não muda.
- Nenhuma mudança em `db.js` ou `model.js` pra essa parte — é reorganização de apresentação, os dados e a lógica de custeio já existem.

## Dados: insumos novos e sub-receitas

### Insumos-base novos

| Insumo | Unidade | Tamanho | Preço | Fonte |
|---|---|---|---|---|
| Ácido cítrico | g | 1000 | R$30,90 | pesquisado (Casa dos Químicos) |
| Ácido málico | g | 1000 | R$45,00 | pesquisado (Amazon) |
| Vinagre de maçã | ml | 1000 | R$19,98 | pesquisado (Amazon) |
| Chá do Amor (Talchá) | g | 50 | R$79,00 | site oficial talcha.com.br — usuário confirmou assumir que R$79,00 é o pacote de 50g (site não expõe preço por tamanho em fetch estático) |
| Suco de tangerina | ml | 1000 | 0 (revisar) | não achei preço confiável de suco de tangerina fresco a granel |

Corrige unidade de dois insumos já existentes (hoje cadastrados como "unidade", preço já bate com pacote de 1kg, então só ajusta a base — preço não muda):

| Insumo | De | Para |
|---|---|---|
| Açúcar Refinado | unidade / 1 / R$2,59 | g / 1000 / R$2,59 |
| Sal Refinado | unidade / 1 / R$2,21 | g / 1000 / R$2,21 |

Reaproveita sem alteração: Água Filtrada (já criada hoje, revisar) e Limão Tahiti (já criado hoje, R$4,50/kg — usado aqui como "casca de limão tahiti" no Super Suco).

### Conversão pra produção interna (tipo comprado → producao_interna)

| Produção | Ingredientes (`producao_itens`) | Rendimento (`tamanho_unidade`) |
|---|---|---|
| **Xarope de Açúcar (Simples)** | Açúcar Refinado 1000g + Água Filtrada 1000ml | 2000ml (soma direta dos volumes/massas de entrada — aproximação simples, sem fator de dissolução) |
| **Super Suco** | Água Filtrada 10000ml + Limão Tahiti (casca) 600g + Açúcar Refinado 600g + Ácido Cítrico 480g + Ácido Málico 240g + Sal Refinado 20g | 10000ml (~84% do peso é água; sólidos dissolvem/infundem sem alterar volume de forma relevante) |
| **Shrub de Tangerina Clementina** | Suco de Tangerina 600g + Vinagre de Maçã 70g + **Xarope de Açúcar (produção acima) 200g** | 870ml (soma direta — os 3 componentes são líquidos de densidade próxima à da água) |
| **Vodka com Chá do Amor (Talchá)** | Absolut Vodka 1000ml + Chá do Amor (Talchá) 15g | 1000ml — proporção é "referência inicial" do `clareira.md` (nota do próprio documento: "ainda em calibração por prova") |

Shrub consome Xarope de Açúcar como ingrediente — é o encadeamento que `recalcAllProducoesInternas()` já resolve sozinho (múltiplos passes até os custos estabilizarem). Se o preço do açúcar mudar, o custo sobe em cascata até o Shrub sem intervenção manual.

**Fica de fora desta rodada:** Chá do Amor concentrado (sem álcool) — usuário confirmou que a proporção ainda não está definida. Continua como insumo "comprado", preço 0 (revisar).

## Migração

Script único, executado direto contra o banco (mesmas funções `run`/`runInsert`/`updateInsumoField`/`recalcAllProducoesInternas` já usadas hoje pra popular as 14 fichas), nesta ordem:

1. Corrigir unidade de Açúcar Refinado e Sal Refinado.
2. Criar os 5 insumos-base novos (ácido cítrico, málico, vinagre de maçã, chá do amor, suco de tangerina).
3. Para cada um dos 4 insumos a converter: `UPDATE insumos SET tipo = 'producao_interna' WHERE id = ?` (mantém o `id`).
4. Inserir os `producao_itens` de cada um dos 4, na ordem da tabela acima (Xarope antes do Shrub, já que o Shrub depende dele).
5. Rodar `recalcAllProducoesInternas()` uma vez ao final.
6. Exportar `.db` atualizado.

## Verificação

- Contagem de `producao_itens` por produção bate com a tabela acima (mesmo tipo de checagem que pegou o bug do Tom Collins hoje mais cedo).
- As 6 fichas técnicas que usam Super Suco ou Xarope de Açúcar (Estufa, Pomar, Refúgio, Tom Collins, New York Sour, Mango Passion) devem ter `calcCustoReceita` maior que antes da migração, sem eu tocar nelas diretamente — é o teste de que o encadeamento funcionou.
- Aba Produções mostra exatamente os insumos com `tipo='producao_interna'` (4 convertidos + qualquer produção interna pré-existente, se houver); aba Insumos não mostra mais nenhum.
- Sem erro no console ao trocar entre as duas abas e abrir/fechar os editores.
