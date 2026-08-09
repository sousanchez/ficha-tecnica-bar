// Estado global e conexao dos elementos da UI aos handlers de dados/render

let state = {
  tab: 'insumos',
  insumoFiltro: '',
  editingReceitaId: null,
  editingProducaoId: null,
  editingEventoId: null,
};

// Lista fixa de categorias de insumo (bar). Um valor ja salvo que nao esteja
// nesta lista continua aparecendo normalmente - so nao sera perdido.
const CATEGORIAS_INSUMO = [
  'Vodka', 'Gin', 'Whisky', 'Rum', 'Cachaça', 'Tequila', 'Licor/Aperitivo', 'Vermute/Conhaque',
  'Cerveja', 'Vinho/Espumante', 'Água', 'Refrigerante', 'Suco', 'Café', 'Xarope/Bitter',
  'Hortifruti', 'Descartáveis', 'Limpeza', 'Produção interna', 'Outros',
];

// Liga um conjunto de campos de formulario (input cujo id mapeia para um campo do banco)
// a uma funcao de update - usado pelos editores de receita e de producao interna.
function bindFormFields(ids, fieldMap, numericFields, getEditingId, updateFn) {
  ids.forEach((id) => {
    document.getElementById(id).addEventListener('change', (e) => {
      const field = fieldMap[id];
      let value = e.target.value;
      if (numericFields.includes(field)) value = parseFloat(value) || 0;
      updateFn(getEditingId(), field, value);
      refreshAll();
    });
  });
}

// Liga a linha "selecionar insumo + quantidade + adicionar" usada pelos dois editores.
function bindAddItemRow(btnId, selectId, qtdId, unidadeId, getEditingId, addFn) {
  const select = document.getElementById(selectId);
  const spanEl = document.getElementById(unidadeId);
  select.addEventListener('change', (e) => updateUnidadeAviso(e.target, spanEl));
  document.getElementById(btnId).addEventListener('click', () => {
    const qtdInput = document.getElementById(qtdId);
    const insumoId = Number(select.value);
    const qtd = parseFloat(qtdInput.value);
    if (!insumoId || !qtd) return;
    addFn(getEditingId(), insumoId, qtd);
    qtdInput.value = '';
    select.value = '';
    updateUnidadeAviso(select, spanEl);
    refreshAll();
  });
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
  document.getElementById('btn-add-producao').addEventListener('click', addProducaoInterna);
  document.getElementById('btn-add-receita').addEventListener('click', addReceita);
  document.getElementById('btn-export-db').addEventListener('click', exportDb);
  document.getElementById('btn-import-db').addEventListener('click', () => document.getElementById('input-import-db').click());
  document.getElementById('input-import-db').addEventListener('change', (e) => {
    if (e.target.files[0]) importDb(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('modal-close').addEventListener('click', () => { closeReceitaEditor(); refreshAll(); });
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') { closeReceitaEditor(); refreshAll(); }
  });
  document.getElementById('btn-delete-receita').addEventListener('click', () => deleteReceita(state.editingReceitaId));
  document.getElementById('btn-print-receita').addEventListener('click', () => printReceita(state.editingReceitaId));

  document.getElementById('modal-producao-close').addEventListener('click', () => { closeProducaoEditor(); refreshAll(); });
  document.getElementById('modal-producao-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-producao-overlay') { closeProducaoEditor(); refreshAll(); }
  });
  document.getElementById('btn-delete-producao').addEventListener('click', () => {
    const id = state.editingProducaoId;
    deleteInsumo(id);
    if (!query('SELECT id FROM insumos WHERE id = ?', [id]).length) {
      closeProducaoEditor();
      refreshAll();
    }
  });

  document.getElementById('btn-add-evento').addEventListener('click', addEvento);
  document.getElementById('modal-evento-close').addEventListener('click', () => { closeEventoEditor(); refreshAll(); });
  document.getElementById('modal-evento-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-evento-overlay') { closeEventoEditor(); refreshAll(); }
  });
  document.getElementById('btn-delete-evento').addEventListener('click', () => deleteEvento(state.editingEventoId));

  bindFormFields(
    ['re-nome', 're-categoria', 're-copo', 're-guarnicao', 're-modo-preparo', 're-preco-venda', 're-utensilios', 're-tempo-preparo', 're-rendimento', 're-vendas-periodo'],
    {
      're-nome': 'nome', 're-categoria': 'categoria', 're-copo': 'copo', 're-guarnicao': 'guarnicao',
      're-modo-preparo': 'modo_preparo', 're-preco-venda': 'preco_venda', 're-utensilios': 'utensilios',
      're-tempo-preparo': 'tempo_preparo', 're-rendimento': 'rendimento', 're-vendas-periodo': 'vendas_periodo',
    },
    ['preco_venda', 'vendas_periodo'],
    () => state.editingReceitaId,
    updateReceitaField
  );
  bindAddItemRow('btn-add-item', 're-add-insumo', 're-add-qtd', 're-add-unidade', () => state.editingReceitaId, addReceitaItem);

  bindFormFields(
    ['pr-nome', 'pr-categoria', 'pr-unidade', 'pr-rendimento', 'pr-fator'],
    { 'pr-nome': 'nome', 'pr-categoria': 'categoria', 'pr-unidade': 'unidade_compra', 'pr-rendimento': 'tamanho_unidade', 'pr-fator': 'fator_correcao' },
    ['tamanho_unidade', 'fator_correcao'],
    () => state.editingProducaoId,
    updateInsumoField
  );
  bindAddItemRow('btn-add-pritem', 'pr-add-insumo', 'pr-add-qtd', 'pr-add-unidade', () => state.editingProducaoId, addProducaoItem);

  bindFormFields(
    ['ev-nome', 'ev-data', 'ev-convidados', 'ev-horas', 'ev-doses-por-pessoa', 'ev-preco-pacote-pessoa'],
    {
      'ev-nome': 'nome', 'ev-data': 'data', 'ev-convidados': 'convidados', 'ev-horas': 'horas',
      'ev-doses-por-pessoa': 'doses_por_pessoa', 'ev-preco-pacote-pessoa': 'preco_pacote_pessoa',
    },
    ['convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa'],
    () => state.editingEventoId,
    updateEventoField
  );
}

document.addEventListener('DOMContentLoaded', init);
