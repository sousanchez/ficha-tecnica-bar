# Markup alvo + salvar explícito na ficha técnica — design

## Contexto

Ficha técnica (receita) já mostra indicador "Markup" (`re-markup`, `calcIndicadores` em `model.js`) — só leitura, `precoVenda / custo`. Pedido: campo "Markup alvo" editável, sugere `preco_venda = custo × markup_alvo`, com stepper (+/- 0,5) atualizando "Preço sugerido" ao vivo.

Durante revisão, pedido cresceu: editor de receita inteiro passa de auto-save (cada campo grava no banco no `change`) pra **salvar explícito** — nada grava até clicar "Salvar". Cobre todos os campos do formulário E a lista de insumos da receita (adicionar/remover/quantidade).

Item relacionado no CLAUDE.md ("sugestão automática de preço por CMV alvo", fase 2 da feature de Eventos) é sobre o **pacote de evento**, não a ficha técnica individual — mecanismo parecido, escopo diferente, não é o mesmo trabalho.

## Requisitos

- "Markup alvo": campo numérico editável, step 0,5 (setas nativas do `<input type="number">` sobem/descem 0,5), persiste por ficha técnica.
- "Preço sugerido" (`custo × markup_alvo`) recalcula **ao vivo** conforme markup muda (tecla ou seta) — sem precisar salvar pra ver o número.
- Botão "Aplicar" copia preço sugerido pro campo "Preço de venda" — não é automático.
- Indicador "Markup" (calculado, `precoVenda/custo`) continua existindo como está, pode divergir do markup alvo se o preço de venda for editado depois.
- Editor de receita inteiro (todos os campos do formulário + itens de insumo) vira **salvar explícito**: nada grava no banco até clicar "Salvar". Escopo é só a janela de receita — insumo, produção interna e evento continuam salvando automático, sem mudança.
- Fechar (✕ ou clique fora) com alteração não salva → avisa e pergunta (`confirm`), com opção de voltar pra janela.

## Arquitetura de edição: rascunho em memória

Hoje `bindFormFields` grava no banco a cada `change`. Alternativa descartada: atrasar globalmente o `persist()` (mais simples, mas afeta insumo/produção/evento junto — eles não pediram essa mudança). Escolhido: **rascunho isolado** — só a janela de receita muda de comportamento, todo o resto do app fica exatamente como está.

`state.receitaDraft` guarda uma cópia dos dados da receita em edição, incluindo os itens:

```js
{
  nome, categoria, copo, guarnicao, modo_preparo, preco_venda,
  utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo,
  itens: [{ id, tempId, insumo_id, quantidade, nome, unidade_compra, preco_unitario }]
}
```

- `id`: id real em `receita_itens`, ou `null` se item ainda não existe no banco.
- `tempId`: chave local negativa (`-1, -2, ...`) só pra dar identidade única na tela a um item novo antes de salvar. Itens existentes trazem `tempId: null` (usam `id` real como chave).
- `nome`/`unidade_compra`/`preco_unitario`: copiados do insumo no momento em que o item entra no rascunho (join feito uma vez, não recalculado a cada render) — igual ao formato que `getReceita()` já devolve, então `renderItemsTable` não precisa mudar.

Custo do rascunho não consulta o banco de novo a cada render — soma direto os itens do rascunho:

```js
function calcCustoDraftItens(itens) {
  return itens.reduce((sum, it) => sum + it.quantidade * it.preco_unitario, 0);
}
```

## Correção de bug encontrado durante o design: cursor pulando ao digitar

Se a janela inteira reconstruir todos os campos (`.value = ...`) a cada tecla, o cursor pula pro fim do campo a cada letra digitada — trava digitar em "Nome"/"Modo de preparo". Causa: hoje `renderReceitaEditor()` sempre repovoa TODOS os campos a partir da fonte de verdade, e isso precisa continuar acontecendo ao abrir a ficha, mas não pode rodar de novo a cada tecla.

Fix: separar em duas funções.

- **Abrir a ficha / depois de salvar**: popula todos os campos (`.value =`) a partir do rascunho — roda só nesses dois momentos, nunca durante digitação.
- **A cada mudança de campo/insumo/markup**: só recalcula e atualiza as áreas derivadas (custo, CMV, indicador Markup, margem, Preço sugerido) e redesenha a tabela de itens — nunca reescreve o `.value` do campo que disparou o evento.

```js
function renderReceitaEditorCampos() {   // roda so ao abrir / apos salvar
  const d = state.receitaDraft;
  document.getElementById('re-nome').value = d.nome;
  document.getElementById('re-categoria').value = d.categoria || '';
  document.getElementById('re-copo').value = d.copo || '';
  document.getElementById('re-guarnicao').value = d.guarnicao || '';
  document.getElementById('re-modo-preparo').value = d.modo_preparo || '';
  document.getElementById('re-preco-venda').value = d.preco_venda;
  document.getElementById('re-utensilios').value = d.utensilios || '';
  document.getElementById('re-tempo-preparo').value = d.tempo_preparo || '';
  document.getElementById('re-rendimento').value = d.rendimento || '';
  document.getElementById('re-vendas-periodo').value = d.vendas_periodo || 0;
  document.getElementById('re-markup-alvo').value = d.markup_alvo || 0;

  const select = document.getElementById('re-add-insumo');
  const insumos = getInsumosParaSelect();
  select.innerHTML = '<option value="">Selecionar insumo...</option>' + insumos.map((i) => `<option value="${i.id}" data-un="${i.unidade_compra}">${escapeHtml(i.nome)}</option>`).join('');
  updateUnidadeAviso(select, document.getElementById('re-add-unidade'));

  renderReceitaEditorComputados();
}

function renderReceitaEditorComputados() {   // roda a cada edicao no rascunho
  const custo = calcCustoDraftItens(state.receitaDraft.itens);
  const precoSugerido = calcPrecoSugerido(custo, state.receitaDraft.markup_alvo || 0);
  const { cmv, markup, margem } = calcIndicadores(custo, state.receitaDraft.preco_venda);

  document.getElementById('re-custo').textContent = fmtMoeda(custo);
  document.getElementById('re-preco-sugerido').textContent = fmtMoeda(precoSugerido);
  const cmvEl = document.getElementById('re-cmv');
  cmvEl.textContent = fmtPct(cmv);
  cmvEl.className = 'badge ' + cmvClass(cmv);
  document.getElementById('re-markup').textContent = markup ? markup.toFixed(2) + 'x' : '-';
  document.getElementById('re-margem').textContent = fmtMoeda(margem);

  renderItemsTable(
    document.getElementById('re-itens-tbody'),
    state.receitaDraft.itens.map((it) => ({ ...it, id: it.id ?? it.tempId })),
    'Nenhum insumo adicionado',
    draftUpdateItemQtd,
    draftRemoveItem
  );
}
```

`renderItemsTable` (já existe, compartilhada com o editor de produção interna) não muda — só troca os callbacks que ela recebe, no editor de receita:

```js
let nextTempId = -1;
function draftAddItem(insumoId, quantidade) {
  const insumo = query('SELECT nome, unidade_compra, preco_unitario FROM insumos WHERE id = ?', [insumoId])[0];
  if (!insumo) return;
  state.receitaDraft.itens.push({ id: null, tempId: nextTempId--, insumo_id: insumoId, quantidade, ...insumo });
  renderReceitaEditorComputados();
}
function draftUpdateItemQtd(itemId, quantidade) {
  const it = state.receitaDraft.itens.find((i) => (i.id ?? i.tempId) === itemId);
  if (it) it.quantidade = quantidade;
  renderReceitaEditorComputados();
}
function draftRemoveItem(itemId) {
  state.receitaDraft.itens = state.receitaDraft.itens.filter((i) => (i.id ?? i.tempId) !== itemId);
  renderReceitaEditorComputados();
}
```

Editor de produção interna continua chamando `updateProducaoItemQtd`/`removeProducaoItem`/`addProducaoItem` direto (sem rascunho) — nenhuma mudança lá.

## Campos do formulário: novo binding só pro editor de receita

`bindFormFields` (main.js, genérico, usado por receita/produção/evento) fica como está — passa a ser usado só por produção e evento. Editor de receita ganha binding próprio, que grava no rascunho em vez do banco:

```js
function bindDraftFormFields(ids, fieldMap, numericFields) {
  ids.forEach((id) => {
    document.getElementById(id).addEventListener('input', (e) => {
      const field = fieldMap[id];
      let value = e.target.value;
      if (numericFields.includes(field)) value = parseFloat(value) || 0;
      state.receitaDraft[field] = value;
      renderReceitaEditorComputados();
    });
  });
}
```

Evento `input` (não `change`) em todos os campos do rascunho — dispara a cada tecla/clique de seta, não só ao sair do campo. Seguro porque `renderReceitaEditorComputados()` nunca reescreve `.value` de campo nenhum (só as áreas derivadas), então não quebra o cursor em campo nenhum, nem no "Markup alvo" que precisa da atualização ao vivo.

## Salvar: reconciliação com o banco

Nenhuma função de gravação nova — reusa as que já existem:

```js
function salvarReceita() {
  const id = state.editingReceitaId;
  const d = state.receitaDraft;
  const allowed = ['nome', 'categoria', 'copo', 'guarnicao', 'modo_preparo', 'preco_venda', 'utensilios', 'tempo_preparo', 'rendimento', 'vendas_periodo', 'markup_alvo'];
  for (const field of allowed) setField('receitas', allowed, id, field, d[field]);

  const itensBanco = query('SELECT id FROM receita_itens WHERE receita_id = ?', [id]);
  const idsNoRascunho = new Set(d.itens.filter((it) => it.id).map((it) => it.id));
  for (const it of itensBanco) {
    if (!idsNoRascunho.has(it.id)) removeReceitaItem(it.id);
  }
  for (const it of d.itens) {
    if (it.id) updateReceitaItemQtd(it.id, it.quantidade);
    else addReceitaItem(id, it.insumo_id, it.quantidade);
  }

  abrirRascunhoDaReceita(id);   // recarrega o rascunho do banco (itens novos ganham id real) + vira o novo "baseline salvo"
  refreshAll();
}
```

`updateReceitaItemQtd` roda pra item existente mesmo se a quantidade não mudou — sem checagem de "mudou ou não" porque `run()` já é barato o bastante nesse volume de dado (mesmo padrão de simplicidade do resto do `model.js`, que não teve esse tipo de otimização em nenhum outro lugar).

**Trade-off aceito:** cada `setField`/`updateReceitaItemQtd`/`addReceitaItem`/`removeReceitaItem` já persiste sozinho (`run()` já faz isso, ver `db.js`), então um clique em Salvar dispara vários `persist()` seguidos (um por campo escalar + um por item) em vez de um só no fim. Redundante, mas reusa funções já testadas em vez de abrir uma exceção "grava sem persistir" só pro Salvar — no volume de dado atual (centenas de linhas) o custo é imperceptível. Se o banco crescer muito, otimizar depois é trocar `run()`/`runInsert()` por variantes que não persistem sozinhas dentro de `salvarReceita`, com um `persist()` manual no fim — não faz parte deste trabalho.

`abrirRascunhoDaReceita(id)` monta `state.receitaDraft` a partir de `getReceita(id)` e tira o snapshot `state.receitaDraftSalvo` — não renderiza nada sozinha, só monta dado. Chamada tanto ao abrir a ficha quanto depois de salvar (reconciliação):

```js
function abrirRascunhoDaReceita(id) {
  const r = getReceita(id);
  state.receitaDraft = {
    nome: r.nome, categoria: r.categoria, copo: r.copo, guarnicao: r.guarnicao, modo_preparo: r.modo_preparo,
    preco_venda: r.preco_venda, utensilios: r.utensilios, tempo_preparo: r.tempo_preparo, rendimento: r.rendimento,
    vendas_periodo: r.vendas_periodo, markup_alvo: r.markup_alvo || 0,
    itens: r.itens.map((it) => ({ id: it.id, tempId: null, insumo_id: it.insumo_id, quantidade: it.quantidade, nome: it.nome, unidade_compra: it.unidade_compra, preco_unitario: it.preco_unitario })),
  };
  state.receitaDraftSalvo = JSON.parse(JSON.stringify(state.receitaDraft));
}

function openReceitaEditor(id) {
  state.editingReceitaId = id;
  abrirRascunhoDaReceita(id);
  document.getElementById('modal-overlay').classList.add('active');
  renderReceitaEditorCampos();
}
```

**Achado #2 do self-review:** `refreshAll()` (`render.js`) hoje tem a linha `if (state.editingReceitaId) renderReceitaEditor();` — essa função deixa de existir (virou `renderReceitaEditorCampos` + `renderReceitaEditorComputados`). Precisa virar:

```js
if (state.editingReceitaId) renderReceitaEditorCampos();
```

`renderReceitaEditorCampos()` já termina chamando `renderReceitaEditorComputados()`, então repovoar tudo cobre os dois. `refreshAll()` só é chamado com a ficha aberta em dois momentos agora — depois de `salvarReceita()` (repovoar é seguro, nenhum campo está com foco no clique do botão) e depois de fechar (`fecharReceitaEditorComCheck`, onde o campo já não importa mais). Nenhuma chamada de `refreshAll()` acontece durante digitação/edição do rascunho — essas usam `renderReceitaEditorComputados()` direto.

## Fechar com confirmação

```js
function fecharReceitaEditorComCheck() {
  const sujo = JSON.stringify(state.receitaDraft) !== JSON.stringify(state.receitaDraftSalvo);
  if (sujo && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
  closeReceitaEditor();
  refreshAll();
}
```

`state.receitaDraftSalvo`: cópia profunda (`JSON.parse(JSON.stringify(...))`) do rascunho tirada ao abrir a ficha e de novo depois de cada salvar — baseline de comparação. `main.js` troca as chamadas atuais de `modal-close`/`modal-overlay` de `closeReceitaEditor()` direto pra essa função nova.

## Modelo de dados

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

`ficha-tecnica-bar/db.js:86-104` (`migrateSchema`), mesmo bloco que já trata colunas de `receitas`:

```js
addColIfMissing('receitas', 'markup_alvo REAL DEFAULT 0');
```

`ficha-tecnica-bar/model.js:198-201` (`addReceita`) — `INSERT` ganha a coluna:

```js
function addReceita() {
  const id = runInsert(`INSERT INTO receitas (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo)
       VALUES ('Nova receita', '', '', '', '', 0, 1, '', '', '', 0, 0)`);
  openReceitaEditor(id);
}
```

`ficha-tecnica-bar/model.js:215-218` (`updateReceitaField`) — whitelist ganha o campo (usado pelo `salvarReceita`, não mais por binding automático de campo):

```js
function updateReceitaField(id, field, value) {
  const allowed = ['nome', 'categoria', 'modo_preparo', 'copo', 'guarnicao', 'preco_venda', 'utensilios', 'tempo_preparo', 'rendimento', 'vendas_periodo', 'markup_alvo'];
  setField('receitas', allowed, id, field, value);
}
```

Função pura nova, mesmo padrão de `calcCustoEventoPessoa` — entra no `module.exports`:

```js
function calcPrecoSugerido(custo, markupAlvo) {
  return custo * markupAlvo;
}
```

## UI

`ficha-tecnica-bar/index.html:113` — campo novo ao lado de "Preço de venda":

```html
<label>Preço de venda <input id="re-preco-venda" type="number" step="0.01"></label>
<label>Markup alvo <input id="re-markup-alvo" type="number" step="0.5" placeholder="Ex: 3.5"></label>
```

`ficha-tecnica-bar/index.html:118` — linha de sugestão, entre o `form-grid` e "Modo de preparo":

```html
</div>
<div class="sugestao-preco">
  Preço sugerido: <strong id="re-preco-sugerido">R$ 0,00</strong>
  <button id="btn-aplicar-preco-sugerido" class="btn secondary">Aplicar</button>
</div>
<label class="full">Modo de preparo
```

Rodapé do modal (`ficha-tecnica-bar/index.html`, `modal-footer` da receita) ganha o botão Salvar:

```html
<div class="modal-footer">
  <button id="btn-salvar-receita" class="btn">Salvar</button>
  <button id="btn-print-receita" class="btn secondary">Imprimir ficha técnica</button>
  <button id="btn-delete-receita" class="btn danger">Excluir ficha técnica</button>
</div>
```

`ficha-tecnica-bar/style.css` — regra nova pra linha de sugestão, mesmo espírito de `.unidade-aviso`:

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

`main.js`: `attachGlobalHandlers()` troca o bloco atual de receita —

```js
document.getElementById('modal-close').addEventListener('click', fecharReceitaEditorComCheck);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') fecharReceitaEditorComCheck();
});
document.getElementById('btn-salvar-receita').addEventListener('click', salvarReceita);
document.getElementById('btn-delete-receita').addEventListener('click', () => deleteReceita(state.editingReceitaId));
document.getElementById('btn-print-receita').addEventListener('click', () => printReceita(state.editingReceitaId));

bindDraftFormFields(
  ['re-nome', 're-categoria', 're-copo', 're-guarnicao', 're-modo-preparo', 're-preco-venda', 're-utensilios', 're-tempo-preparo', 're-rendimento', 're-vendas-periodo', 're-markup-alvo'],
  {
    're-nome': 'nome', 're-categoria': 'categoria', 're-copo': 'copo', 're-guarnicao': 'guarnicao',
    're-modo-preparo': 'modo_preparo', 're-preco-venda': 'preco_venda', 're-utensilios': 'utensilios',
    're-tempo-preparo': 'tempo_preparo', 're-rendimento': 'rendimento', 're-vendas-periodo': 'vendas_periodo',
    're-markup-alvo': 'markup_alvo',
  },
  ['preco_venda', 'vendas_periodo', 'markup_alvo']
);

document.getElementById('btn-aplicar-preco-sugerido').addEventListener('click', () => {
  const custo = calcCustoDraftItens(state.receitaDraft.itens);
  const sugerido = calcPrecoSugerido(custo, state.receitaDraft.markup_alvo || 0);
  state.receitaDraft.preco_venda = sugerido;
  document.getElementById('re-preco-venda').value = sugerido;
  renderReceitaEditorComputados();
});

const reAddInsumoSelect = document.getElementById('re-add-insumo');
reAddInsumoSelect.addEventListener('change', (e) => updateUnidadeAviso(e.target, document.getElementById('re-add-unidade')));
document.getElementById('btn-add-item').addEventListener('click', () => {
  const qtdInput = document.getElementById('re-add-qtd');
  const insumoId = Number(reAddInsumoSelect.value);
  const qtd = parseFloat(qtdInput.value);
  if (!insumoId || !qtd) return;
  draftAddItem(insumoId, qtd);
  qtdInput.value = '';
  reAddInsumoSelect.value = '';
  updateUnidadeAviso(reAddInsumoSelect, document.getElementById('re-add-unidade'));
});
```

`btn-add-item` para de usar `bindAddItemRow` genérico (que chama `addReceitaItem` direto no banco) — vira handler próprio chamando `draftAddItem`, mas preserva o `change` do `select` que já existia (avisa "un: ml"/"cadastrado em unidade" ao trocar de insumo, antes de clicar Adicionar). `bindAddItemRow` continua servindo o editor de produção interna sem mudança.

## Casos de borda

- **`markup_alvo` vazio ou 0** → "Preço sugerido: R$ 0,00"; botão Aplicar continua clicável, aplicaria R$ 0,00 se clicado — sem esconder/desabilitar, mesmo padrão do resto do app.
- **Custo 0** (ficha sem insumo ainda) → sugerido = 0, mesmo tratamento.
- **Markup negativo digitado** → sem validação de sinal, mesmo padrão de `preco_compra` e outros campos numéricos.
- **Rascunho idêntico ao salvo** → fechar não pergunta nada (`JSON.stringify` bate igual).
- **Clicar Salvar sem alteração nenhuma** → grava mesmo assim, idempotente, sem efeito colateral (mesmos valores voltam a ser gravados).
- **Item novo sem insumo/quantidade válidos** → mesma validação que já existe na linha "Adicionar" hoje (`if (!insumoId || !qtd) return;`), preservada no handler novo.
- **Imprimir com rascunho não salvo** → imprime o que já está salvo no banco, ignora edição pendente — decisão consciente (spec não pede impressão de rascunho, evita complexidade de layout de impressão a partir de dado não-persistido).
- **Excluir com rascunho não salvo** → `deleteReceita` ignora o rascunho, apaga a receita do banco de vez — mesmo comportamento de hoje, sem mudança.
- **Ficha técnica de banco salvo antes dessa mudança** → `markup_alvo` chega `NULL`/ausente até `migrateSchema` rodar (já roda em todo load); `d.markup_alvo || 0` cobre o intervalo.

## Testes

- **Unit (`node --test`)**: `calcPrecoSugerido` — custo×markup normal (10×3=30), custo=0→0, markup=0→0, markup negativo (10×-1=-10).
- **Manual no navegador**:
  1. Abrir ficha existente, editar nome/categoria/preço/markup e adicionar/remover um insumo, **sem salvar** — confirmar que nada mudou nas outras abas/cards do app (nada persistiu).
  2. Digitar em "Nome" e "Modo de preparo" sem o cursor pular — confirma o fix do bug de re-render.
  3. Mexer nas setas do "Markup alvo" (+0,5/-0,5) — "Preço sugerido" muda a cada clique, ao vivo.
  4. Clicar "Aplicar" — "Preço de venda" muda, CMV/Markup(indicador)/Margem recalculam.
  5. Fechar (✕) com alteração pendente → aviso aparece; cancelar → janela continua aberta com o rascunho intacto.
  6. Clicar "Salvar" → fechar sem aviso (nada pendente) → F5 → tudo persistiu, incluindo itens novos com id real (dá pra editar/remover de novo depois do reload).

## Fora de escopo

- Sugestão de markup a partir de CMV alvo (caminho inverso ao pedido aqui).
- Qualquer ligação com a feature de Eventos — este markup é por ficha técnica individual.
- Salvar explícito nos editores de insumo/produção interna/evento — só a janela de receita muda.
- Imprimir a partir do rascunho não salvo.
