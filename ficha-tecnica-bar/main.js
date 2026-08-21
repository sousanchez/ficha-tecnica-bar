// Estado global e conexao dos elementos da UI aos handlers de dados/render

let state = {
  tab: 'dashboard',
  insumoFiltro: '',
  insumosSelecionados: new Set(),
  editingReceitaId: null,
  editingProducaoId: null,
  editingEventoId: null,
  receitaDraft: null,
  receitaDraftSalvo: null,
  producaoDraft: null,
  producaoDraftSalvo: null,
  eventoDraft: null,
  eventoDraftSalvo: null,
};

// Lista fixa de categorias de insumo (bar). Um valor ja salvo que nao esteja
// nesta lista continua aparecendo normalmente - so nao sera perdido.
const CATEGORIAS_INSUMO = [
  'Vodka', 'Gin', 'Whisky', 'Rum', 'Cachaça', 'Tequila', 'Licor/Aperitivo', 'Vermute/Conhaque',
  'Cerveja', 'Vinho/Espumante', 'Água', 'Refrigerante', 'Suco', 'Café', 'Xarope/Bitter',
  'Hortifruti', 'Descartáveis', 'Limpeza', 'Produção interna', 'Outros',
];

// Liga um conjunto de campos de formulario a um dos tres rascunhos em memoria
// (state[draftKey]) - nada persiste no banco ate o Salvar de cada editor.
function bindDraftFormFields(ids, fieldMap, numericFields, draftKey, onChange) {
  ids.forEach((id) => {
    document.getElementById(id).addEventListener('input', (e) => {
      const field = fieldMap[id];
      let value = e.target.value;
      if (numericFields.includes(field)) value = parseFloat(value) || 0;
      state[draftKey][field] = value;
      onChange();
    });
  });
}

function salvarReceita() {
  const id = state.editingReceitaId;
  const d = state.receitaDraft;
  const allowed = ['nome', 'categoria', 'copo', 'guarnicao', 'modo_preparo', 'tempo_preparo', 'rendimento'];
  for (const field of allowed) updateReceitaField(id, field, d[field]);

  const itensBanco = query('SELECT id FROM receita_itens WHERE receita_id = ?', [id]);
  const idsNoRascunho = new Set(d.itens.filter((it) => it.id).map((it) => it.id));
  for (const it of itensBanco) {
    if (!idsNoRascunho.has(it.id)) removeReceitaItem(it.id);
  }
  for (const it of d.itens) {
    if (it.id) updateReceitaItemQtd(it.id, it.quantidade);
    else addReceitaItem(id, it.insumo_id, it.quantidade);
  }

  abrirRascunhoDaReceita(id);
  refreshAll();
}

function salvarProducao() {
  const id = state.editingProducaoId;
  const d = state.producaoDraft;
  const allowed = ['nome', 'categoria', 'unidade_compra', 'tamanho_unidade', 'fator_correcao'];
  for (const field of allowed) updateInsumoField(id, field, d[field]);

  const itensBanco = query('SELECT id FROM producao_itens WHERE producao_id = ?', [id]);
  const idsNoRascunho = new Set(d.itens.filter((it) => it.id).map((it) => it.id));
  for (const it of itensBanco) {
    if (!idsNoRascunho.has(it.id)) removeProducaoItem(it.id);
  }
  for (const it of d.itens) {
    if (it.id) updateProducaoItemQtd(it.id, it.quantidade);
    else addProducaoItem(id, it.ingrediente_id, it.quantidade);
  }

  abrirRascunhoDaProducao(id);
  refreshAll();
}

function salvarEvento() {
  const id = state.editingEventoId;
  const d = state.eventoDraft;
  const allowed = ['nome', 'data', 'convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa'];
  for (const field of allowed) updateEventoField(id, field, d[field]);

  const evAtual = getEvento(id);
  const idsAtuais = new Set(evAtual.receitas.map((r) => r.id));
  const idsNoRascunho = new Set(d.receitaIds);
  for (const r of evAtual.receitas) {
    if (!idsNoRascunho.has(r.id)) removeEventoReceita(r.vinculo_id);
  }
  for (const receitaId of d.receitaIds) {
    if (!idsAtuais.has(receitaId)) addEventoReceita(id, receitaId);
  }

  abrirRascunhoDoEvento(id);
  refreshAll();
}

function attachGlobalHandlers() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      renderTabs();
    });
  });
  document.getElementById('filtro-nome').addEventListener('input', (e) => {
    state.insumoFiltro = e.target.value;
    renderInsumos();
  });
  document.getElementById('btn-add-insumo').addEventListener('click', addInsumo);
  document.getElementById('btn-detect-volumes').addEventListener('click', autoDetectVolumes);
  document.getElementById('btn-delete-selecionados').addEventListener('click', deleteInsumosSelecionados);
  document.getElementById('chk-insumos-all').addEventListener('change', (e) => {
    const idsVisiveis = getInsumos().filter((r) => r.tipo !== 'producao_interna').map((r) => r.id);
    if (e.target.checked) idsVisiveis.forEach((id) => state.insumosSelecionados.add(id));
    else idsVisiveis.forEach((id) => state.insumosSelecionados.delete(id));
    renderInsumos();
  });
  document.getElementById('btn-add-producao').addEventListener('click', addProducaoInterna);
  document.getElementById('btn-add-receita').addEventListener('click', addReceita);
  document.getElementById('btn-export-db').addEventListener('click', exportDb);
  document.getElementById('btn-import-db').addEventListener('click', () => document.getElementById('input-import-db').click());
  document.getElementById('input-import-db').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const nInsumos = query('SELECT COUNT(*) as c FROM insumos')[0].c;
      const nReceitas = query('SELECT COUNT(*) as c FROM receitas')[0].c;
      const confirmou = confirm(
        `Importar "${file.name}" vai substituir todos os dados atuais ` +
        `(${nInsumos} insumo(s), ${nReceitas} ficha(s) técnica(s)) e não pode ser desfeito.\n\n` +
        `Um backup do banco atual (.db) vai ser baixado automaticamente antes de importar.`
      );
      if (confirmou) {
        exportDb();
        importDb(file);
      }
    }
    e.target.value = '';
  });

  document.getElementById('modal-close').addEventListener('click', fecharReceitaEditorComCheck);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') fecharReceitaEditorComCheck();
  });
  document.getElementById('btn-salvar-receita').addEventListener('click', salvarReceita);
  document.getElementById('btn-delete-receita').addEventListener('click', () => deleteReceita(state.editingReceitaId));
  document.getElementById('btn-print-receita').addEventListener('click', () => printReceita(state.editingReceitaId));

  document.getElementById('modal-producao-close').addEventListener('click', fecharProducaoEditorComCheck);
  document.getElementById('modal-producao-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-producao-overlay') fecharProducaoEditorComCheck();
  });
  document.getElementById('btn-salvar-producao').addEventListener('click', salvarProducao);
  document.getElementById('btn-delete-producao').addEventListener('click', () => {
    const id = state.editingProducaoId;
    deleteInsumo(id);
    if (!query('SELECT id FROM insumos WHERE id = ?', [id]).length) {
      closeProducaoEditor();
      refreshAll();
    }
  });

  document.getElementById('btn-add-evento').addEventListener('click', addEvento);
  document.getElementById('modal-evento-close').addEventListener('click', fecharEventoEditorComCheck);
  document.getElementById('modal-evento-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-evento-overlay') fecharEventoEditorComCheck();
  });
  document.getElementById('btn-salvar-evento').addEventListener('click', salvarEvento);
  document.getElementById('btn-delete-evento').addEventListener('click', () => deleteEvento(state.editingEventoId));

  window.addEventListener('beforeunload', (e) => {
    const drafts = [
      [state.editingReceitaId, state.receitaDraft, state.receitaDraftSalvo],
      [state.editingProducaoId, state.producaoDraft, state.producaoDraftSalvo],
      [state.editingEventoId, state.eventoDraft, state.eventoDraftSalvo],
    ];
    const algumSujo = drafts.some(([editingId, draft, salvo]) => editingId && JSON.stringify(draft) !== JSON.stringify(salvo));
    if (algumSujo) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  bindDraftFormFields(
    ['re-nome', 're-categoria', 're-copo', 're-guarnicao', 're-modo-preparo', 're-tempo-preparo', 're-rendimento'],
    {
      're-nome': 'nome', 're-categoria': 'categoria', 're-copo': 'copo', 're-guarnicao': 'guarnicao',
      're-modo-preparo': 'modo_preparo', 're-tempo-preparo': 'tempo_preparo', 're-rendimento': 'rendimento',
    },
    [],
    'receitaDraft',
    renderReceitaEditorComputados
  );

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

  bindDraftFormFields(
    ['pr-nome', 'pr-categoria', 'pr-unidade', 'pr-rendimento', 'pr-fator'],
    { 'pr-nome': 'nome', 'pr-categoria': 'categoria', 'pr-unidade': 'unidade_compra', 'pr-rendimento': 'tamanho_unidade', 'pr-fator': 'fator_correcao' },
    ['tamanho_unidade', 'fator_correcao'],
    'producaoDraft',
    renderProducaoEditorComputados
  );

  const prAddInsumoSelect = document.getElementById('pr-add-insumo');
  prAddInsumoSelect.addEventListener('change', (e) => updateUnidadeAviso(e.target, document.getElementById('pr-add-unidade')));
  document.getElementById('btn-add-pritem').addEventListener('click', () => {
    const qtdInput = document.getElementById('pr-add-qtd');
    const ingredienteId = Number(prAddInsumoSelect.value);
    const qtd = parseFloat(qtdInput.value);
    if (!ingredienteId || !qtd) return;
    draftAddItemProducao(ingredienteId, qtd);
    qtdInput.value = '';
    prAddInsumoSelect.value = '';
    updateUnidadeAviso(prAddInsumoSelect, document.getElementById('pr-add-unidade'));
  });

  bindDraftFormFields(
    ['ev-nome', 'ev-data', 'ev-convidados', 'ev-horas', 'ev-doses-por-pessoa', 'ev-preco-pacote-pessoa'],
    {
      'ev-nome': 'nome', 'ev-data': 'data', 'ev-convidados': 'convidados', 'ev-horas': 'horas',
      'ev-doses-por-pessoa': 'doses_por_pessoa', 'ev-preco-pacote-pessoa': 'preco_pacote_pessoa',
    },
    ['convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa'],
    'eventoDraft',
    renderEventoEditorComputados
  );

  document.getElementById('btn-cloud-status').addEventListener('click', () => {
    document.getElementById('cloud-erro').hidden = true;
    document.getElementById('cloud-pin-input').value = cloudPin || '';
    document.getElementById('btn-cloud-desconectar').hidden = !cloudPin;
    document.getElementById('modal-cloud-overlay').classList.add('active');
  });
  document.getElementById('modal-cloud-close').addEventListener('click', () => {
    document.getElementById('modal-cloud-overlay').classList.remove('active');
  });
  document.getElementById('modal-cloud-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-cloud-overlay') document.getElementById('modal-cloud-overlay').classList.remove('active');
  });
  document.getElementById('btn-cloud-conectar').addEventListener('click', async () => {
    const pin = document.getElementById('cloud-pin-input').value.trim();
    const erroEl = document.getElementById('cloud-erro');
    erroEl.hidden = true;
    if (!pin) return;
    try {
      await conectarNuvem(pin);
      document.getElementById('modal-cloud-overlay').classList.remove('active');
    } catch (err) {
      erroEl.textContent = 'PIN incorreto ou sem conexão. Tente de novo.';
      erroEl.hidden = false;
    }
  });
  document.getElementById('btn-cloud-desconectar').addEventListener('click', () => {
    desconectarNuvem();
    document.getElementById('modal-cloud-overlay').classList.remove('active');
  });
}

document.addEventListener('DOMContentLoaded', init);
