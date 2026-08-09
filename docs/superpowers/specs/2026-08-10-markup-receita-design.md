# Markup alvo com preço sugerido na ficha técnica — design

## Contexto

A ficha técnica (receita) já mostra um indicador "Markup" (`re-markup` em `index.html`, calculado por `calcIndicadores` em `model.js`) — mas é só leitura: `precoVenda / custo`, derivado do preço que o usuário já digitou. O pedido é o inverso: digitar um markup **alvo** e o app sugerir o preço de venda a partir dele (`preco_venda_sugerido = custo × markup_alvo`).

Item relacionado já estava anotado como fase 2 no CLAUDE.md ("sugestão automática de preço por CMV alvo"), mas aquele item era pro pacote de evento. Este aqui é no nível da ficha técnica individual (receita) — mecanismo parecido, lugar diferente.

## Requisitos (do brainstorming)

- Campo novo "Markup alvo" (input), **não substitui** o campo "Preço de venda" existente — os dois convivem. O indicador "Markup" (calculado, já existe) continua mostrando o real, que pode divergir do alvo se o preço de venda for editado depois.
- App mostra "Preço sugerido" (`custo × markup_alvo`), recalculado ao vivo sempre que a ficha renderiza (ex: custo muda porque um insumo mudou de preço).
- Botão "Aplicar" copia o preço sugerido pro campo "Preço de venda" existente — não é automático, é um clique.
- `markup_alvo` fica **salvo por ficha técnica** (não é calculadora descartável) — abre a ficha de novo depois, o markup digitado continua lá.

## Modelo de dados

Uma coluna nova em `receitas`, mesmo padrão já usado pra `vendas_periodo`/`utensilios`/etc: aparece nos dois lugares (schema de banco novo + migração de banco existente), não é tabela nova.

`ficha-tecnica-bar/db.js:21-34` (`SCHEMA_SQL`, tabela `receitas`) ganha a coluna:

```sql
CREATE TABLE IF NOT EXISTS receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT DEFAULT '',
  modo_preparo TEXT DEFAULT '',
  copo TEXT DEFAULT '',
  guarnicao TEXT DEFAULT '',
  preco_venda REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1,
  utensilios TEXT DEFAULT '',
  tempo_preparo TEXT DEFAULT '',
  rendimento TEXT DEFAULT '',
  vendas_periodo REAL DEFAULT 0,
  markup_alvo REAL DEFAULT 0
);
```

`ficha-tecnica-bar/db.js:86-104` (`migrateSchema`) ganha uma linha, no mesmo bloco que já trata as colunas de `receitas`:

```js
addColIfMissing('receitas', 'markup_alvo REAL DEFAULT 0');
```

`ficha-tecnica-bar/model.js:198-201` (`addReceita`) — o `INSERT` explícito precisa listar a coluna nova:

```js
function addReceita() {
  const id = runInsert(`INSERT INTO receitas (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo)
       VALUES ('Nova receita', '', '', '', '', 0, 1, '', '', '', 0, 0)`);
  openReceitaEditor(id);
}
```

## Cálculo

Função pura nova em `model.js`, mesmo padrão de `calcCustoEventoPessoa` (testável sem banco):

```js
function calcPrecoSugerido(custo, markupAlvo) {
  return custo * markupAlvo;
}
```

Precisa entrar no `module.exports` no fim de `model.js` (mesmo bloco que já exporta `calcIndicadores`/`calcCustoEventoPessoa`) pros testes unitários importarem.

`ficha-tecnica-bar/model.js:215-218` (`updateReceitaField`) — whitelist ganha o campo novo:

```js
function updateReceitaField(id, field, value) {
  const allowed = ['nome', 'categoria', 'modo_preparo', 'copo', 'guarnicao', 'preco_venda', 'utensilios', 'tempo_preparo', 'rendimento', 'vendas_periodo', 'markup_alvo'];
  setField('receitas', allowed, id, field, value);
}
```

Não precisa de função nova pra "aplicar" — o botão Aplicar chama o `updateReceitaField` que já existe, passando `preco_venda` como campo e o preço sugerido recém-calculado como valor.

## UI

`ficha-tecnica-bar/index.html:113` — campo novo logo depois de "Preço de venda", dentro do `form-grid` já existente:

```html
<label>Preço de venda <input id="re-preco-venda" type="number" step="0.01"></label>
<label>Markup alvo <input id="re-markup-alvo" type="number" step="0.1" placeholder="Ex: 3.5"></label>
```

`ficha-tecnica-bar/index.html:118` — linha de sugestão, entre o fechamento do `form-grid` e o label "Modo de preparo":

```html
</div>
<div class="sugestao-preco">
  Preço sugerido: <strong id="re-preco-sugerido">R$ 0,00</strong>
  <button id="btn-aplicar-preco-sugerido" class="btn secondary">Aplicar</button>
</div>
<label class="full">Modo de preparo
```

`ficha-tecnica-bar/style.css` — regra nova, mesmo espírito de `.unidade-aviso`/`.add-item-row` já existentes:

```css
.sugestao-preco {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 16px;
  font-size: 13px;
  color: var(--muted);
}
.sugestao-preco strong { color: var(--text); }
```

`ficha-tecnica-bar/render.js:237-252` (`renderReceitaEditor`) — duas linhas novas, mesmo bloco que já popula os outros campos e calcula os indicadores:

```js
document.getElementById('re-vendas-periodo').value = r.vendas_periodo || 0;
document.getElementById('re-markup-alvo').value = r.markup_alvo || 0;
document.getElementById('re-preco-sugerido').textContent = fmtMoeda(calcPrecoSugerido(custo, r.markup_alvo || 0));
```

`ficha-tecnica-bar/main.js` — o campo `re-markup-alvo` entra na lista de `bindFormFields` já existente pro editor de receita (linhas 100-109), junto dos outros:

```js
bindFormFields(
  ['re-nome', 're-categoria', 're-copo', 're-guarnicao', 're-modo-preparo', 're-preco-venda', 're-utensilios', 're-tempo-preparo', 're-rendimento', 're-vendas-periodo', 're-markup-alvo'],
  {
    're-nome': 'nome', 're-categoria': 'categoria', 're-copo': 'copo', 're-guarnicao': 'guarnicao',
    're-modo-preparo': 'modo_preparo', 're-preco-venda': 'preco_venda', 're-utensilios': 'utensilios',
    're-tempo-preparo': 'tempo_preparo', 're-rendimento': 'rendimento', 're-vendas-periodo': 'vendas_periodo',
    're-markup-alvo': 'markup_alvo',
  },
  ['preco_venda', 'vendas_periodo', 'markup_alvo'],
  () => state.editingReceitaId,
  updateReceitaField
);
```

E um handler novo pro botão Aplicar, junto dos outros `addEventListener` de `attachGlobalHandlers()`:

```js
document.getElementById('btn-aplicar-preco-sugerido').addEventListener('click', () => {
  const id = state.editingReceitaId;
  const custo = calcCustoReceita(id);
  const markupAlvo = parseFloat(document.getElementById('re-markup-alvo').value) || 0;
  updateReceitaField(id, 'preco_venda', calcPrecoSugerido(custo, markupAlvo));
  refreshAll();
});
```

Recalcula `custo` e lê o markup direto do input em vez de reaproveitar o texto já formatado em `re-preco-sugerido` (evita fazer parse de string tipo "R$ 12,34" de volta pra número — mais frágil que só recalcular).

## Casos de borda

- **`markup_alvo` vazio ou 0** → "Preço sugerido: R$ 0,00"; botão Aplicar continua clicável e aplicaria R$ 0,00 se clicado — sem esconder/desabilitar, mesmo padrão do resto do app (nenhum outro campo numérico valida faixa ou desabilita botão condicionalmente).
- **Custo 0** (ficha sem insumo ainda) → sugerido = 0, mesmo tratamento acima.
- **Markup negativo digitado** → sem validação de sinal, sugerido fica negativo, mesmo padrão de `preco_compra` e outros campos numéricos do app hoje.
- **Ficha técnica de banco salvo antes dessa mudança** → `markup_alvo` chega `NULL`/ausente até a primeira leitura via `migrateSchema` rodar (que já roda em todo load, existente); `r.markup_alvo || 0` no render cobre o caso de vir `null` antes da migração rodar ou entre um insert antigo e um novo.

## Testes

- **Unit (`node --test`)**: `calcPrecoSugerido` — custo×markup normal (ex: 10×3 = 30), custo=0→0, markup=0→0, markup negativo (sem trava, ex: 10×-1 = -10).
- **Manual no navegador**: abrir uma ficha técnica existente, digitar markup alvo, conferir que "Preço sugerido" calcula ao vivo (sem precisar salvar/recarregar), clicar Aplicar, confirmar que "Preço de venda" muda pro valor sugerido e que CMV/Markup(indicador)/Margem recalculam juntos a partir do novo preço. F5 confirma que o markup alvo digitado persistiu.

## Fora de escopo

- Sugestão de markup a partir de um CMV alvo (o pedido aqui é o caminho inverso — markup→preço, não CMV→preço). Se isso for pedido depois, é uma spec separada.
- Qualquer ligação com a feature de Eventos — este markup é por ficha técnica individual, não entra no cálculo de custo/pessoa do pacote.
