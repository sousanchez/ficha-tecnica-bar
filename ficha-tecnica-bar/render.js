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
  if (state.editingReceitaId) renderReceitaEditorCampos();
  if (state.editingProducaoId) renderProducaoEditor();
  if (state.editingEventoId) renderEventoEditor();
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
  const rows = getInsumos();
  const tbody = document.getElementById('insumos-tbody');
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

  tbody.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.insumoId);
      const field = e.target.dataset.field;
      let value = e.target.value;
      if (['preco_compra', 'tamanho_unidade', 'fator_correcao', 'estoque_minimo', 'estoque_atual'].includes(field)) value = parseFloat(value) || 0;
      updateInsumoField(id, field, value);
      refreshAll();
    });
  });
}

function renderReceitas() {
  const receitas = getReceitas();
  const list = document.getElementById('receitas-list');
  list.innerHTML = receitas.map((r) => {
    const { cmv, margem } = calcIndicadores(r.custo, r.preco_venda);
    return `
      <div class="receita-card" onclick="openReceitaEditor(${r.id})">
        <div class="receita-card-title">${escapeHtml(r.nome)}</div>
        <div class="receita-card-row"><span>Custo</span><strong>${fmtMoeda(r.custo)}</strong></div>
        <div class="receita-card-row"><span>Venda</span><strong>${fmtMoeda(r.preco_venda)}</strong></div>
        <div class="receita-card-row"><span>CMV</span><strong class="badge ${cmvClass(cmv)}">${fmtPct(cmv)}</strong></div>
        <div class="receita-card-row"><span>Margem</span><strong>${fmtMoeda(margem)}</strong></div>
      </div>
    `;
  }).join('') || '<p class="muted">Nenhuma ficha tecnica cadastrada ainda.</p>';
}

function renderDashboard() {
  const receitas = getReceitas();
  const tbody = document.getElementById('dashboard-tbody');
  const sorted = [...receitas].sort((a, b) => {
    const ca = calcIndicadores(a.custo, a.preco_venda).cmv ?? -1;
    const cb = calcIndicadores(b.custo, b.preco_venda).cmv ?? -1;
    return cb - ca;
  });
  tbody.innerHTML = sorted.map((r) => {
    const { cmv, markup, margem } = calcIndicadores(r.custo, r.preco_venda);
    return `
      <tr>
        <td>${escapeHtml(r.nome)}</td>
        <td class="num">${fmtMoeda(r.custo)}</td>
        <td class="num">${fmtMoeda(r.preco_venda)}</td>
        <td class="num"><span class="badge ${cmvClass(cmv)}">${fmtPct(cmv)}</span></td>
        <td class="num">${markup ? markup.toFixed(2) + 'x' : '-'}</td>
        <td class="num">${fmtMoeda(margem)}</td>
        <td class="num">${r.vendas_periodo || '-'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="muted">Nenhuma ficha tecnica cadastrada ainda.</td></tr>';
  document.getElementById('dashboard-total').textContent = `${receitas.length} ficha(s) tecnica(s)`;
  renderMenuEngineering();
}

function renderMenuEngineering() {
  const container = document.getElementById('menu-engineering');
  const quad = computeMenuEngineering();
  if (!quad) {
    container.innerHTML = '<p class="muted">Preencha o campo "Vendas no periodo" nas fichas tecnicas para ver a engenharia de cardapio aqui.</p>';
    return;
  }
  const item = (r) => `<div class="me-item"><span>${escapeHtml(r.nome)}</span><span class="muted">${r.vendas_periodo}x · ${fmtMoeda(r.margem)}</span></div>`;
  const box = (title, cls, items) => `
    <div class="me-quad ${cls}">
      <h4>${title}</h4>
      ${items.length ? items.map(item).join('') : '<span class="muted">Nenhum item</span>'}
    </div>`;
  container.innerHTML = `
    <div class="me-grid">
      ${box('⭐ Estrela — alta venda, boa margem', 'me-estrela', quad.estrela)}
      ${box('🐴 Cavalo de batalha — alta venda, margem baixa', 'me-cavalo', quad.cavalo)}
      ${box('❓ Enigma — baixa venda, boa margem', 'me-enigma', quad.enigma)}
      ${box('🍍 Abacaxi — baixa venda, margem baixa', 'me-abacaxi', quad.abacaxi)}
    </div>`;
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
        <div class="receita-card-row"><span>CMV</span><strong class="badge ${cmvClass(cmv)}">${fmtPct(cmv)}</strong></div>
      </div>
    `;
  }).join('') || '<p class="muted">Nenhum evento cadastrado ainda.</p>';
}

// Renderiza a tabela de itens (insumo/quantidade/unidade/custo) usada tanto pelo
// editor de receita quanto pelo de producao interna - a estrutura e identica,
// so mudam os dados e as funcoes de atualizar/remover.
function renderItemsTable(tbody, itens, emptyMsg, onQtyChange, onRemove) {
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
      refreshAll();
    });
  });
  tbody.querySelectorAll('button[data-remove-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      onRemove(Number(e.target.dataset.removeId));
      refreshAll();
    });
  });
}

// ---------- Editor de producao interna (modal) ----------
function openProducaoEditor(id) {
  state.editingProducaoId = id;
  document.getElementById('modal-producao-overlay').classList.add('active');
  renderProducaoEditor();
}
function closeProducaoEditor() {
  state.editingProducaoId = null;
  document.getElementById('modal-producao-overlay').classList.remove('active');
}
function renderProducaoEditor() {
  const p = getProducao(state.editingProducaoId);
  if (!p) return;

  document.getElementById('pr-nome').value = p.nome;
  document.getElementById('pr-categoria').value = p.categoria || '';
  document.getElementById('pr-unidade').value = p.unidade_compra;
  document.getElementById('pr-rendimento').value = p.tamanho_unidade;
  document.getElementById('pr-fator').value = p.fator_correcao;
  document.getElementById('pr-custo-total').textContent = fmtMoeda(p.preco_compra);
  document.getElementById('pr-custo-unitario').textContent = `${fmtMoeda(p.preco_unitario)} / ${p.unidade_compra}`;

  renderItemsTable(
    document.getElementById('pr-itens-tbody'),
    p.itens,
    'Nenhum ingrediente adicionado',
    updateProducaoItemQtd,
    removeProducaoItem
  );

  const select = document.getElementById('pr-add-insumo');
  const insumos = getInsumosExcluindo(p.id);
  select.innerHTML = '<option value="">Selecionar insumo...</option>' + insumos.map((i) => `<option value="${i.id}" data-un="${i.unidade_compra}">${escapeHtml(i.nome)}</option>`).join('');
  updateUnidadeAviso(select, document.getElementById('pr-add-unidade'));
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
function closeReceitaEditor() {
  state.editingReceitaId = null;
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
function renderReceitaEditorComputados() {
  const d = state.receitaDraft;
  if (!d) return;
  const custo = calcCustoDraftItens(d.itens);
  const precoSugerido = calcPrecoSugerido(custo, d.markup_alvo || 0);
  const { cmv, markup, margem } = calcIndicadores(custo, d.preco_venda);

  document.getElementById('re-custo').textContent = fmtMoeda(custo);
  document.getElementById('re-preco-sugerido').textContent = fmtMoeda(precoSugerido);
  const cmvEl = document.getElementById('re-cmv');
  cmvEl.textContent = fmtPct(cmv);
  cmvEl.className = 'badge ' + cmvClass(cmv);
  document.getElementById('re-markup').textContent = markup ? markup.toFixed(2) + 'x' : '-';
  document.getElementById('re-margem').textContent = fmtMoeda(margem);

  renderItemsTable(
    document.getElementById('re-itens-tbody'),
    d.itens.map((it) => ({ ...it, id: it.id ?? it.tempId })),
    'Nenhum insumo adicionado',
    draftUpdateItemQtd,
    draftRemoveItem
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
  const it = state.receitaDraft.itens.find((i) => (i.id ?? i.tempId) === itemId);
  if (it) it.quantidade = quantidade;
  renderReceitaEditorComputados();
}
function draftRemoveItem(itemId) {
  state.receitaDraft.itens = state.receitaDraft.itens.filter((i) => (i.id ?? i.tempId) !== itemId);
  renderReceitaEditorComputados();
}

// ---------- Editor de evento (modal) ----------
function openEventoEditor(id) {
  state.editingEventoId = id;
  document.getElementById('modal-evento-overlay').classList.add('active');
  renderEventoEditor();
}
function closeEventoEditor() {
  state.editingEventoId = null;
  document.getElementById('modal-evento-overlay').classList.remove('active');
}
function renderEventoEditor() {
  const ev = getEvento(state.editingEventoId);
  if (!ev) return;

  document.getElementById('ev-nome').value = ev.nome;
  document.getElementById('ev-data').value = ev.data || '';
  document.getElementById('ev-convidados').value = ev.convidados;
  document.getElementById('ev-horas').value = ev.horas;
  document.getElementById('ev-doses-por-pessoa').value = ev.doses_por_pessoa;
  document.getElementById('ev-preco-pacote-pessoa').value = ev.preco_pacote_pessoa;

  const todasReceitas = getReceitas();
  const selecionadasIds = new Set(ev.receitas.map((r) => r.id));
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
        addEventoReceita(ev.id, receitaId);
      } else {
        const vinculo = ev.receitas.find((r) => r.id === receitaId);
        if (vinculo) removeEventoReceita(vinculo.vinculo_id);
      }
      refreshAll();
    });
  });

  const custosSelecionados = ev.receitas.map((r) => r.custo);
  const custoPorPessoa = calcCustoEventoPessoa(custosSelecionados, ev.doses_por_pessoa);
  const { cmv, markup, margem } = calcIndicadores(custoPorPessoa, ev.preco_pacote_pessoa);

  document.getElementById('ev-custo-pessoa').textContent = ev.receitas.length
    ? fmtMoeda(custoPorPessoa)
    : 'Selecione ao menos 1 drink';
  const cmvEl = document.getElementById('ev-cmv');
  cmvEl.textContent = fmtPct(cmv);
  cmvEl.className = 'badge ' + cmvClass(cmv);
  document.getElementById('ev-markup').textContent = markup ? markup.toFixed(2) + 'x' : '-';
  document.getElementById('ev-margem').textContent = fmtMoeda(margem);
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
  const { cmv, markup, margem } = calcIndicadores(custo, r.preco_venda);
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
    <p><strong>Utensílios:</strong> ${escapeHtml(r.utensilios || '-')}</p>
    <p><strong>Modo de preparo:</strong><br>${escapeHtml(r.modo_preparo || '-').replace(/\n/g, '<br>')}</p>
    <table><thead><tr><th>Insumo</th><th>Quantidade</th></tr></thead><tbody>${itensHtml}</tbody></table>
    <div class="indicadores">
      <div>Custo total<strong>${fmtMoeda(custo)}</strong></div>
      <div>Preço de venda<strong>${fmtMoeda(r.preco_venda)}</strong></div>
      <div>CMV<strong>${fmtPct(cmv)}</strong></div>
      <div>Markup<strong>${markup ? markup.toFixed(2) + 'x' : '-'}</strong></div>
      <div>Margem<strong>${fmtMoeda(margem)}</strong></div>
    </div>
    </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
