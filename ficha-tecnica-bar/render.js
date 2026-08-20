// Camada de visualizacao: tabs, tabelas, dashboard, modais de edicao e impressao

function renderAll() {
  renderTabs();
  refreshAll();
}
// Toda mutacao de dados afeta insumos/receitas/dashboard (custos propagam entre eles)
// e, se um modal de edicao estiver aberto, seu conteudo tambem precisa ser atualizado.
function refreshAll() {
  renderInsumos();
  renderReceitas();
  renderDashboard();
  renderEventos();
  renderProducoes();
  if (state.editingReceitaId) renderReceitaEditorCampos();
  if (state.editingProducaoId) renderProducaoEditorCampos();
  if (state.editingEventoId) renderEventoEditorCampos();
}

function renderTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${state.tab}`);
  });
}

function categoriaOptionsHtml(valorAtual) {
  const lista = CATEGORIAS_INSUMO.includes(valorAtual) || !valorAtual
    ? CATEGORIAS_INSUMO
    : [valorAtual, ...CATEGORIAS_INSUMO];
  return lista.map((c) => `<option value="${escapeHtml(c)}" ${c === valorAtual ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}
function unidadeOptionsHtml(valorAtual) {
  const unidades = ['ml', 'L', 'g', 'kg', 'unidade'];
  return unidades.map((u) => `<option value="${u}" ${u === valorAtual ? 'selected' : ''}>${u}</option>`).join('');
}

function renderInsumos() {
  const rows = getInsumos().filter((r) => r.tipo !== 'producao_interna');
  const tbody = document.getElementById('insumos-tbody');

  // O rebuild abaixo recria todos os inputs da tabela, entao o elemento focado
  // (o que o usuario acabou de editar ou tabulou para) e destruido e o foco
  // cai pro <body>. Capturamos aqui quem esta focado - pela combinacao
  // insumo+campo, nao pela referencia do elemento - e restauramos apos o
  // rebuild, senao Tab entre 224 linhas fica impossivel.
  const ativo = document.activeElement;
  const focoAnterior = ativo && tbody.contains(ativo) && ativo.dataset.insumoId
    ? {
        insumoId: ativo.dataset.insumoId,
        field: ativo.dataset.field,
        selectionStart: typeof ativo.selectionStart === 'number' ? ativo.selectionStart : null,
        selectionEnd: typeof ativo.selectionEnd === 'number' ? ativo.selectionEnd : null,
      }
    : null;

  tbody.innerHTML = rows.map((r) => {
    const isProducao = r.tipo === 'producao_interna';
    const tipoBadge = isProducao
      ? `<span class="badge">Produção</span> <button class="icon-btn" title="Editar producao" onclick="openProducaoEditor(${r.id})">✎</button>`
      : `<span class="badge good">Comprado</span>`;
    const precoCell = isProducao
      ? `<span class="muted" title="Custo calculado a partir dos ingredientes">${fmtMoeda(r.preco_compra)}</span>`
      : `<input class="num" data-insumo-id="${r.id}" data-field="preco_compra" type="number" step="0.01" value="${r.preco_compra}">`;
    const estoqueBaixo = r.estoque_minimo > 0 && r.estoque_atual < r.estoque_minimo;
    return `
    <tr>
      <td><input class="input-nome" data-insumo-id="${r.id}" data-field="nome" value="${escapeHtml(r.nome)}"></td>
      <td>${tipoBadge}</td>
      <td><select data-insumo-id="${r.id}" data-field="categoria">${categoriaOptionsHtml(r.categoria)}</select></td>
      <td><input data-insumo-id="${r.id}" data-field="fornecedor" value="${escapeHtml(r.fornecedor || '')}"></td>
      <td class="num">${precoCell}</td>
      <td><select data-insumo-id="${r.id}" data-field="unidade_compra">${unidadeOptionsHtml(r.unidade_compra)}</select></td>
      <td class="num"><input class="num" data-insumo-id="${r.id}" data-field="tamanho_unidade" type="number" step="0.01" value="${r.tamanho_unidade}"></td>
      <td class="num"><input class="num" data-insumo-id="${r.id}" data-field="fator_correcao" type="number" step="0.01" value="${r.fator_correcao}" title="Multiplicador de perda (ex: 1.15 = 15% de perda). 1 = sem perda"></td>
      <td class="num muted">${fmtMoeda(r.preco_unitario)}${r.preco_compra === 0 ? ' <span class="badge bad">revisar</span>' : ''}</td>
      <td class="num"><input class="num" data-insumo-id="${r.id}" data-field="estoque_minimo" type="number" step="0.01" value="${r.estoque_minimo}"></td>
      <td class="num"><input class="num" data-insumo-id="${r.id}" data-field="estoque_atual" type="number" step="0.01" value="${r.estoque_atual}"> ${estoqueBaixo ? '<span class="badge bad">baixo</span>' : ''}</td>
      <td><button class="icon-btn" title="Excluir" onclick="deleteInsumo(${r.id})">✕</button></td>
    </tr>
  `;
  }).join('');
  document.getElementById('insumos-count').textContent = `${rows.length} insumo(s)`;

  if (focoAnterior) {
    const seletor = `[data-insumo-id="${focoAnterior.insumoId}"][data-field="${focoAnterior.field}"]`;
    const novoEl = tbody.querySelector(seletor);
    if (novoEl) {
      novoEl.focus();
      if (focoAnterior.selectionStart !== null && novoEl.setSelectionRange) {
        novoEl.setSelectionRange(focoAnterior.selectionStart, focoAnterior.selectionEnd);
      }
    }
  }

  tbody.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.insumoId);
      const field = e.target.dataset.field;
      let value = e.target.value;
      if (['preco_compra', 'tamanho_unidade', 'fator_correcao', 'estoque_minimo', 'estoque_atual'].includes(field)) value = parseFloat(value) || 0;
      // O navegador so aplica o proximo foco (Tab para o campo seguinte, ou
      // clique em outro campo) DEPOIS que o handler de 'change' termina - se
      // o rebuild rodar aqui dentro, document.activeElement ainda e o campo
      // antigo/<body>, nao o alvo real, e a restauracao de foco abaixo falha.
      // Adiando pro proximo tick, o navegador ja aplicou o foco real quando
      // o rebuild acontece.
      setTimeout(() => {
        updateInsumoField(id, field, value);
        refreshAll();
      }, 0);
    });
  });
}

function renderReceitas() {
  const receitas = getReceitas();
  const list = document.getElementById('receitas-list');
  list.innerHTML = receitas.map((r) => `
      <div class="receita-card" onclick="openReceitaEditor(${r.id})">
        <div class="receita-card-title">${escapeHtml(r.nome)}</div>
        <div class="receita-card-row"><span>Custo</span><strong>${fmtMoeda(r.custo)}</strong></div>
      </div>
    `).join('') || '<p class="muted">Nenhuma ficha tecnica cadastrada ainda.</p>';
}

function renderDashboard() {
  const receitas = getReceitas();
  const tbody = document.getElementById('dashboard-tbody');
  tbody.innerHTML = receitas.map((r) => `
      <tr>
        <td>${escapeHtml(r.nome)}</td>
        <td class="num">${fmtMoeda(r.custo)}</td>
      </tr>
    `).join('') || '<tr><td colspan="2" class="muted">Nenhuma ficha tecnica cadastrada ainda.</td></tr>';
  document.getElementById('dashboard-total').textContent = `${receitas.length} ficha(s) tecnica(s)`;
}

function renderEventos() {
  const eventos = getEventos();
  const list = document.getElementById('eventos-list');
  list.innerHTML = eventos.map((e) => {
    const { cmv } = calcIndicadores(e.custoPorPessoa, e.preco_pacote_pessoa);
    return `
      <div class="receita-card" onclick="openEventoEditor(${e.id})">
        <div class="receita-card-title">${escapeHtml(e.nome)}</div>
        <div class="receita-card-row"><span>Convidados</span><strong>${e.convidados}</strong></div>
        <div class="receita-card-row"><span>Custo/pessoa</span><strong>${fmtMoeda(e.custoPorPessoa)}</strong></div>
        <div class="receita-card-row"><span>CMV</span><strong class="badge ${cmvClass(cmv)}">${cmvIcon(cmv)}${fmtPct(cmv)}</strong></div>
      </div>
    `;
  }).join('') || '<p class="muted">Nenhum evento cadastrado ainda.</p>';
}

function renderProducoes() {
  const rows = query("SELECT * FROM insumos WHERE tipo = 'producao_interna' ORDER BY nome");
  const list = document.getElementById('producoes-list');
  list.innerHTML = rows.map((r) => `
    <div class="receita-card" onclick="openProducaoEditor(${r.id})">
      <div class="receita-card-title">${escapeHtml(r.nome)}</div>
      <div class="receita-card-row"><span>Custo do lote</span><strong>${fmtMoeda(r.preco_compra)}</strong></div>
      <div class="receita-card-row"><span>Custo unitário</span><strong>${fmtMoeda(r.preco_unitario)} / ${r.unidade_compra}</strong></div>
      <div class="receita-card-row"><span>Categoria</span><strong>${escapeHtml(r.categoria || '-')}</strong></div>
    </div>
  `).join('') || '<p class="muted">Nenhuma produção interna cadastrada ainda.</p>';
}

// Renderiza a tabela de itens (insumo/quantidade/unidade/custo) usada tanto pelo
// editor de receita quanto pelo de producao interna - a estrutura e identica,
// so mudam os dados e as funcoes de atualizar/remover.
function renderItemsTable(tbody, itens, emptyMsg, onQtyChange, onRemove, skipRefreshAll) {
  tbody.innerHTML = itens.map((it) => `
    <tr>
      <td>${escapeHtml(it.nome)}</td>
      <td class="num"><input class="num" type="number" step="0.01" value="${it.quantidade}" data-item-id="${it.id}"></td>
      <td>${it.unidade_compra}</td>
      <td class="num">${fmtMoeda(it.quantidade * it.preco_unitario)}</td>
      <td><button class="icon-btn" data-remove-id="${it.id}">✕</button></td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="muted">${emptyMsg}</td></tr>`;

  tbody.querySelectorAll('input[data-item-id]').forEach((el) => {
    el.addEventListener('change', (e) => {
      onQtyChange(Number(e.target.dataset.itemId), parseFloat(e.target.value) || 0);
      if (!skipRefreshAll) refreshAll();
    });
  });
  tbody.querySelectorAll('button[data-remove-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      onRemove(Number(e.target.dataset.removeId));
      if (!skipRefreshAll) refreshAll();
    });
  });
}

// ---------- Editor de producao interna (modal) ----------
// Mesmo padrao de rascunho em memoria + Salvar explicito do editor de receita
// (ver abrirRascunhoDaReceita abaixo) - nada grava no banco ate salvarProducao() (main.js).
function abrirRascunhoDaProducao(id) {
  const p = getProducao(id);
  state.producaoDraft = {
    nome: p.nome, categoria: p.categoria ?? '', unidade_compra: p.unidade_compra,
    tamanho_unidade: p.tamanho_unidade, fator_correcao: p.fator_correcao,
    itens: p.itens.map((it) => ({ id: it.id, tempId: null, ingrediente_id: it.ingrediente_id, quantidade: it.quantidade, nome: it.nome, unidade_compra: it.unidade_compra, preco_unitario: it.preco_unitario })),
  };
  state.producaoDraftSalvo = JSON.parse(JSON.stringify(state.producaoDraft));
}
function openProducaoEditor(id) {
  state.editingProducaoId = id;
  abrirRascunhoDaProducao(id);
  document.getElementById('modal-producao-overlay').classList.add('active');
  renderProducaoEditorCampos();
}
function closeProducaoEditor() {
  state.editingProducaoId = null;
  state.producaoDraft = null;
  state.producaoDraftSalvo = null;
  document.getElementById('modal-producao-overlay').classList.remove('active');
}
function fecharProducaoEditorComCheck() {
  const sujo = JSON.stringify(state.producaoDraft) !== JSON.stringify(state.producaoDraftSalvo);
  if (sujo && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
  closeProducaoEditor();
  refreshAll();
}
function renderProducaoEditorCampos() {
  const d = state.producaoDraft;
  if (!d) return;
  document.getElementById('pr-nome').value = d.nome;
  document.getElementById('pr-categoria').value = d.categoria || '';
  document.getElementById('pr-unidade').value = d.unidade_compra;
  document.getElementById('pr-rendimento').value = d.tamanho_unidade;
  document.getElementById('pr-fator').value = d.fator_correcao;

  const select = document.getElementById('pr-add-insumo');
  const insumos = getInsumosExcluindo(state.editingProducaoId);
  select.innerHTML = '<option value="">Selecionar insumo...</option>' + insumos.map((i) => `<option value="${i.id}" data-un="${i.unidade_compra}">${escapeHtml(i.nome)}</option>`).join('');
  updateUnidadeAviso(select, document.getElementById('pr-add-unidade'));

  renderProducaoEditorComputados();
}
function renderProducaoEditorComputados() {
  const d = state.producaoDraft;
  if (!d) return;
  const custoTotal = calcCustoDraftItens(d.itens);
  const custoUnitario = calcCustoUnitario(custoTotal, d.tamanho_unidade, d.fator_correcao);
  document.getElementById('pr-custo-total').textContent = fmtMoeda(custoTotal);
  document.getElementById('pr-custo-unitario').textContent = `${fmtMoeda(custoUnitario)} / ${d.unidade_compra}`;

  renderItemsTable(
    document.getElementById('pr-itens-tbody'),
    d.itens.map((it) => ({ ...it, id: it.id ?? it.tempId })),
    'Nenhum ingrediente adicionado',
    draftUpdateItemQtdProducao,
    draftRemoveItemProducao,
    true
  );
}

let nextTempIdProducao = -1;
function draftAddItemProducao(ingredienteId, quantidade) {
  if (Number(ingredienteId) === Number(state.editingProducaoId)) {
    alert('Uma produção interna não pode usar a si mesma como ingrediente.');
    return;
  }
  const insumo = query('SELECT nome, unidade_compra, preco_unitario FROM insumos WHERE id = ?', [ingredienteId])[0];
  if (!insumo) return;
  state.producaoDraft.itens.push({ id: null, tempId: nextTempIdProducao--, ingrediente_id: ingredienteId, quantidade, ...insumo });
  renderProducaoEditorComputados();
}
function draftUpdateItemQtdProducao(itemId, quantidade) {
  if (quantidade <= 0) {
    draftRemoveItemProducao(itemId);
    return;
  }
  const it = state.producaoDraft.itens.find((i) => (i.id ?? i.tempId) === itemId);
  if (it) it.quantidade = quantidade;
  renderProducaoEditorComputados();
}
function draftRemoveItemProducao(itemId) {
  state.producaoDraft.itens = state.producaoDraft.itens.filter((i) => (i.id ?? i.tempId) !== itemId);
  renderProducaoEditorComputados();
}

// ---------- Editor de receita (modal) ----------
// Edicao em rascunho: nada grava no banco ate clicar Salvar (main.js).
// renderReceitaEditorCampos() repovoa os inputs - roda so ao abrir ou depois
// de salvar. renderReceitaEditorComputados() so atualiza as areas derivadas
// (custo/CMV/preco sugerido/tabela de itens) e roda a cada edicao no
// rascunho - nunca reescreve o .value de um campo, senao o cursor pula pro
// fim do campo a cada tecla digitada.
function abrirRascunhoDaReceita(id) {
  const r = getReceita(id);
  state.receitaDraft = {
    nome: r.nome, categoria: r.categoria ?? '', copo: r.copo ?? '', guarnicao: r.guarnicao ?? '', modo_preparo: r.modo_preparo ?? '',
    tempo_preparo: r.tempo_preparo ?? '', rendimento: r.rendimento ?? '',
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
function closeReceitaEditor() {
  state.editingReceitaId = null;
  state.receitaDraft = null;
  state.receitaDraftSalvo = null;
  document.getElementById('modal-overlay').classList.remove('active');
}
function fecharReceitaEditorComCheck() {
  const sujo = JSON.stringify(state.receitaDraft) !== JSON.stringify(state.receitaDraftSalvo);
  if (sujo && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
  closeReceitaEditor();
  refreshAll();
}
function renderReceitaEditorCampos() {
  const d = state.receitaDraft;
  if (!d) return;
  document.getElementById('re-nome').value = d.nome;
  document.getElementById('re-categoria').value = d.categoria || '';
  document.getElementById('re-copo').value = d.copo || '';
  document.getElementById('re-guarnicao').value = d.guarnicao || '';
  document.getElementById('re-modo-preparo').value = d.modo_preparo || '';
  document.getElementById('re-tempo-preparo').value = d.tempo_preparo || '';
  document.getElementById('re-rendimento').value = d.rendimento || '';

  const select = document.getElementById('re-add-insumo');
  const insumos = getInsumosParaSelect();
  select.innerHTML = '<option value="">Selecionar insumo...</option>' + insumos.map((i) => `<option value="${i.id}" data-un="${i.unidade_compra}">${escapeHtml(i.nome)}</option>`).join('');
  updateUnidadeAviso(select, document.getElementById('re-add-unidade'));

  renderReceitaEditorComputados();
}
function renderReceitaEditorComputados() {
  const d = state.receitaDraft;
  if (!d) return;
  const custo = calcCustoDraftItens(d.itens);
  document.getElementById('re-custo').textContent = fmtMoeda(custo);

  renderItemsTable(
    document.getElementById('re-itens-tbody'),
    d.itens.map((it) => ({ ...it, id: it.id ?? it.tempId })),
    'Nenhum insumo adicionado',
    draftUpdateItemQtd,
    draftRemoveItem,
    true
  );
}

let nextTempId = -1;
function draftAddItem(insumoId, quantidade) {
  const insumo = query('SELECT nome, unidade_compra, preco_unitario FROM insumos WHERE id = ?', [insumoId])[0];
  if (!insumo) return;
  state.receitaDraft.itens.push({ id: null, tempId: nextTempId--, insumo_id: insumoId, quantidade, ...insumo });
  renderReceitaEditorComputados();
}
function draftUpdateItemQtd(itemId, quantidade) {
  if (quantidade <= 0) {
    draftRemoveItem(itemId);
    return;
  }
  const it = state.receitaDraft.itens.find((i) => (i.id ?? i.tempId) === itemId);
  if (it) it.quantidade = quantidade;
  renderReceitaEditorComputados();
}
function draftRemoveItem(itemId) {
  state.receitaDraft.itens = state.receitaDraft.itens.filter((i) => (i.id ?? i.tempId) !== itemId);
  renderReceitaEditorComputados();
}

// ---------- Editor de evento (modal) ----------
// Mesmo padrao de rascunho + Salvar dos outros dois editores. O checklist de
// drinks tambem vira parte do rascunho (receitaIds) - marcar/desmarcar nao
// grava no banco, so acontece em salvarEvento() (main.js).
function abrirRascunhoDoEvento(id) {
  const e = getEvento(id);
  state.eventoDraft = {
    nome: e.nome, data: e.data || '', convidados: e.convidados, horas: e.horas,
    doses_por_pessoa: e.doses_por_pessoa, preco_pacote_pessoa: e.preco_pacote_pessoa,
    receitaIds: e.receitas.map((r) => r.id),
  };
  state.eventoDraftSalvo = JSON.parse(JSON.stringify(state.eventoDraft));
}
function openEventoEditor(id) {
  state.editingEventoId = id;
  abrirRascunhoDoEvento(id);
  document.getElementById('modal-evento-overlay').classList.add('active');
  renderEventoEditorCampos();
}
function closeEventoEditor() {
  state.editingEventoId = null;
  state.eventoDraft = null;
  state.eventoDraftSalvo = null;
  document.getElementById('modal-evento-overlay').classList.remove('active');
}
function fecharEventoEditorComCheck() {
  const sujo = JSON.stringify(state.eventoDraft) !== JSON.stringify(state.eventoDraftSalvo);
  if (sujo && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
  closeEventoEditor();
  refreshAll();
}
function renderEventoEditorCampos() {
  const d = state.eventoDraft;
  if (!d) return;
  document.getElementById('ev-nome').value = d.nome;
  document.getElementById('ev-data').value = d.data || '';
  document.getElementById('ev-convidados').value = d.convidados;
  document.getElementById('ev-horas').value = d.horas;
  document.getElementById('ev-doses-por-pessoa').value = d.doses_por_pessoa;
  document.getElementById('ev-preco-pacote-pessoa').value = d.preco_pacote_pessoa;

  const todasReceitas = getReceitas();
  const selecionadasIds = new Set(d.receitaIds);
  const checklist = document.getElementById('ev-receitas-checklist');
  checklist.innerHTML = todasReceitas.map((r) => `
    <label class="checklist-item">
      <span><input type="checkbox" data-receita-id="${r.id}" ${selecionadasIds.has(r.id) ? 'checked' : ''}> ${escapeHtml(r.nome)}</span>
      <span class="muted">${fmtMoeda(r.custo)}</span>
    </label>
  `).join('') || '<p class="muted">Nenhuma ficha tecnica cadastrada ainda.</p>';

  checklist.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const receitaId = Number(e.target.dataset.receitaId);
      if (e.target.checked) {
        if (!state.eventoDraft.receitaIds.includes(receitaId)) state.eventoDraft.receitaIds.push(receitaId);
      } else {
        state.eventoDraft.receitaIds = state.eventoDraft.receitaIds.filter((rid) => rid !== receitaId);
      }
      renderEventoEditorComputados();
    });
  });

  renderEventoEditorComputados();
}
function renderEventoEditorComputados() {
  const d = state.eventoDraft;
  if (!d) return;
  const todasReceitas = getReceitas();
  const receitasSelecionadas = todasReceitas.filter((r) => d.receitaIds.includes(r.id));
  const custosSelecionados = receitasSelecionadas.map((r) => r.custo);
  const custoPorPessoa = calcCustoEventoPessoa(custosSelecionados, d.doses_por_pessoa);
  const { cmv, markup, margem } = calcIndicadores(custoPorPessoa, d.preco_pacote_pessoa);

  document.getElementById('ev-custo-pessoa').textContent = receitasSelecionadas.length
    ? fmtMoeda(custoPorPessoa)
    : 'Selecione ao menos 1 drink';
  const cmvEl = document.getElementById('ev-cmv');
  cmvEl.textContent = cmvIcon(cmv) + fmtPct(cmv);
  cmvEl.className = 'badge ' + cmvClass(cmv);
  document.getElementById('ev-markup').textContent = markup ? markup.toFixed(2) + 'x' : '-';
  document.getElementById('ev-margem').textContent = fmtMoeda(margem);

  const totais = calcTotaisEvento(custoPorPessoa, d.preco_pacote_pessoa, d.convidados);
  document.getElementById('ev-custo-total').textContent = fmtMoeda(totais.custoTotal);
  document.getElementById('ev-receita-total').textContent = fmtMoeda(totais.receitaTotal);
  document.getElementById('ev-lucro-total').textContent = fmtMoeda(totais.lucroTotal);
}

// Avisa quando o insumo selecionado para adicionar a uma receita/producao ainda
// esta cadastrado como "unidade" - senao a quantidade digitada (ex: 60) e tratada
// como 60 UNIDADES (garrafas) em vez de 60 ml/g, inflando o custo sem aviso.
function updateUnidadeAviso(selectEl, spanEl) {
  const opt = selectEl.selectedOptions[0];
  const un = opt ? opt.dataset.un : null;
  if (!un) {
    spanEl.textContent = '';
    spanEl.classList.remove('aviso-unidade');
    return;
  }
  if (un === 'unidade') {
    spanEl.textContent = '⚠ cadastrado em "unidade", não ml/g';
    spanEl.classList.add('aviso-unidade');
  } else {
    spanEl.textContent = `un: ${un}`;
    spanEl.classList.remove('aviso-unidade');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Impressao da ficha tecnica (uma receita, formato mural/PDF) ----------
function printReceita(id) {
  const r = getReceita(id);
  if (!r) return;
  const custo = calcCustoReceita(id);
  const itensHtml = r.itens.map((it) => `<tr><td>${escapeHtml(it.nome)}</td><td>${it.quantidade} ${it.unidade_compra}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(r.nome)}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;color:#111;max-width:640px;margin:0 auto}
      h1{margin-bottom:2px}
      .meta{color:#555;margin-bottom:16px;font-size:14px}
      table{width:100%;border-collapse:collapse;margin:12px 0}
      td,th{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:14px}
      .indicadores{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
      .indicadores div{border:1px solid #ccc;padding:8px 14px;border-radius:6px;font-size:13px}
      .indicadores strong{display:block;font-size:16px;margin-top:2px}
      @media print { body{padding:12mm} }
    </style></head><body>
    <h1>${escapeHtml(r.nome)}</h1>
    <div class="meta">${escapeHtml(r.categoria || '')}${r.copo ? ' · Copo: ' + escapeHtml(r.copo) : ''}${r.rendimento ? ' · Rendimento: ' + escapeHtml(r.rendimento) : ''}${r.tempo_preparo ? ' · Tempo: ' + escapeHtml(r.tempo_preparo) : ''}</div>
    <p><strong>Guarnição:</strong> ${escapeHtml(r.guarnicao || '-')}</p>
    <p><strong>Modo de preparo:</strong><br>${escapeHtml(r.modo_preparo || '-').replace(/\n/g, '<br>')}</p>
    <table><thead><tr><th>Insumo</th><th>Quantidade</th></tr></thead><tbody>${itensHtml}</tbody></table>
    <div class="indicadores">
      <div>Custo total<strong>${fmtMoeda(custo)}</strong></div>
    </div>
    </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
