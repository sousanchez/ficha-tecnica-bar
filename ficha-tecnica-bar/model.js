// Regras de negocio: custos, insumos, producoes internas e fichas tecnicas (receitas)

// ---------- Custo de insumos e producoes internas ----------
// preco_unitario = custo por ml/g/unidade JA CORRIGIDO pela perda (fator_correcao).
// Para 'comprado': preco_compra e o preco pago pela unidade de compra.
// Para 'producao_interna': preco_compra e o custo bruto do lote, calculado a partir da propria receita (producao_itens).
function recalcInsumoUnitario(id) {
  const row = query('SELECT preco_compra, tamanho_unidade, fator_correcao FROM insumos WHERE id = ?', [id])[0];
  if (!row) return;
  const tamanho = row.tamanho_unidade > 0 ? row.tamanho_unidade : 1;
  const fator = row.fator_correcao > 0 ? row.fator_correcao : 1;
  const precoUnitario = (row.preco_compra / tamanho) * fator;
  run('UPDATE insumos SET preco_unitario = ? WHERE id = ?', [precoUnitario, id]);
}
function recalcProducaoBase(producaoId) {
  const itens = query('SELECT quantidade, ingrediente_id FROM producao_itens WHERE producao_id = ?', [producaoId]);
  let custo = 0;
  for (const it of itens) {
    const ing = query('SELECT preco_unitario FROM insumos WHERE id = ?', [it.ingrediente_id])[0];
    custo += it.quantidade * (ing ? ing.preco_unitario : 0);
  }
  run('UPDATE insumos SET preco_compra = ? WHERE id = ?', [custo, producaoId]);
}
// Producoes internas podem usar outras producoes internas como ingrediente,
// entao repetimos algumas passadas ate os custos estabilizarem (encadeamento simples).
function recalcAllProducoesInternas() {
  const ids = query("SELECT id FROM insumos WHERE tipo = 'producao_interna'").map((r) => r.id);
  const EPS = 1e-9;
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const id of ids) {
      const before = query('SELECT preco_unitario FROM insumos WHERE id = ?', [id])[0]?.preco_unitario ?? 0;
      recalcProducaoBase(id);
      recalcInsumoUnitario(id);
      const after = query('SELECT preco_unitario FROM insumos WHERE id = ?', [id])[0]?.preco_unitario ?? 0;
      if (Math.abs(after - before) > EPS) changed = true;
    }
    if (!changed) return; // custos estabilizaram, nao precisa gastar os passes restantes
  }
  if (ids.length) {
    console.warn(`recalcAllProducoesInternas: custo pode nao ter convergido apos 5 passes (${ids.length} producao(oes) interna(s) encadeada(s) - revise se ha cadeia muito profunda).`);
  }
}

// ---------- Insumos ----------
function getInsumos() {
  let sql = 'SELECT * FROM insumos WHERE 1=1';
  const params = [];
  if (state.insumoFiltro) {
    sql += ' AND UPPER(nome) LIKE ?';
    params.push(`%${state.insumoFiltro.toUpperCase()}%`);
  }
  sql += ' ORDER BY nome';
  return query(sql, params);
}

// Listas leves (id/nome/unidade) usadas pelos selects "adicionar insumo" dos
// editores de receita/producao - view nao deveria precisar conhecer o schema.
function getInsumosParaSelect() {
  return query('SELECT id, nome, unidade_compra FROM insumos ORDER BY nome');
}
function getInsumosExcluindo(id) {
  return query('SELECT id, nome, unidade_compra FROM insumos WHERE id != ? ORDER BY nome', [id]);
}

// Reconhece o volume/peso da garrafa/embalagem a partir do nome do insumo
// (ex: "GIN FORDS 750ML" -> 750 ml, "AGUA 1,5L" -> 1500 ml, "ALCAPARRAS 2KG" -> 2000 g).
// Assim o custo pode ser calculado por ml/g em vez de "por unidade" quando o volume e conhecido.
function detectVolumeFromName(nome) {
  const n = (nome || '').toUpperCase();
  let m;
  if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*ML\b/))) {
    return { unidade: 'ml', tamanho: parseFloat(m[1].replace(',', '.')) };
  }
  if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*L\b/))) {
    return { unidade: 'ml', tamanho: parseFloat(m[1].replace(',', '.')) * 1000 };
  }
  if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*KG\b/))) {
    return { unidade: 'g', tamanho: parseFloat(m[1].replace(',', '.')) * 1000 };
  }
  if ((m = n.match(/(\d+(?:[.,]\d+)?)\s*(G|GR)\b/))) {
    return { unidade: 'g', tamanho: parseFloat(m[1].replace(',', '.')) };
  }
  return null;
}
function isInsumoNoEstadoPadrao(row) {
  return row.unidade_compra === 'unidade' && Number(row.tamanho_unidade) === 1;
}

function updateInsumoField(id, field, value) {
  const allowed = ['nome', 'categoria', 'fornecedor', 'unidade_compra', 'tamanho_unidade', 'preco_compra', 'fator_correcao', 'estoque_minimo', 'estoque_atual'];
  const row = query('SELECT tipo, unidade_compra, tamanho_unidade FROM insumos WHERE id = ?', [id])[0];
  if (!row) return;
  if (row.tipo === 'producao_interna' && field === 'preco_compra') return; // custo de producao e sempre calculado
  if (!setField('insumos', allowed, id, field, value)) return;
  // Se o insumo ainda estava no estado padrao (unidade/1) e o novo nome revela um volume,
  // preenche automaticamente para o custo passar a ser calculado por ml/g.
  if (field === 'nome' && isInsumoNoEstadoPadrao(row)) {
    const detectado = detectVolumeFromName(value);
    if (detectado) {
      run('UPDATE insumos SET unidade_compra = ?, tamanho_unidade = ? WHERE id = ?', [detectado.unidade, detectado.tamanho, id]);
    }
  }
  recalcInsumoUnitario(id);
  recalcAllProducoesInternas(); // cascateia caso este insumo alimente alguma producao interna
}
function autoDetectVolumes() {
  const rows = query("SELECT id, nome FROM insumos WHERE unidade_compra = 'unidade' AND tamanho_unidade = 1");
  let count = 0;
  for (const r of rows) {
    const detectado = detectVolumeFromName(r.nome);
    if (detectado) {
      run('UPDATE insumos SET unidade_compra = ?, tamanho_unidade = ? WHERE id = ?', [detectado.unidade, detectado.tamanho, r.id]);
      recalcInsumoUnitario(r.id);
      count++;
    }
  }
  recalcAllProducoesInternas(); // ja persiste
  refreshAll();
  alert(`${count} insumo(s) atualizado(s) com volume/peso detectado automaticamente a partir do nome.`);
}
function addInsumo() {
  const id = runInsert(`INSERT INTO insumos (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
       VALUES ('Novo insumo', 'Outros', '', '', 'unidade', 1, 0, 0, '', 'comprado', 1, 0, 0)`);
  renderInsumos();
  const el = document.querySelector(`[data-insumo-id="${id}"][data-field="nome"]`);
  if (el) el.focus();
}
function deleteInsumo(id) {
  const usadoReceita = query('SELECT COUNT(*) as c FROM receita_itens WHERE insumo_id = ?', [id])[0].c;
  const usadoProducao = query('SELECT COUNT(*) as c FROM producao_itens WHERE ingrediente_id = ?', [id])[0].c;
  if (usadoReceita > 0 || usadoProducao > 0) {
    alert('Este insumo esta sendo usado em uma ou mais fichas tecnicas/producoes internas e nao pode ser excluido. Remova-o de la primeiro.');
    return;
  }
  if (!confirm('Excluir este insumo?')) return;
  run('DELETE FROM producao_itens WHERE producao_id = ?', [id]);
  run('DELETE FROM insumos WHERE id = ?', [id]);
  renderInsumos();
}

// ---------- Producoes internas (xaropes, espumas, batches...) ----------
function addProducaoInterna() {
  const id = runInsert(`INSERT INTO insumos (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
       VALUES ('Nova produção interna', 'Produção interna', '', '', 'ml', 1000, 0, 0, '', 'producao_interna', 1, 0, 0)`);
  openProducaoEditor(id);
}
function getProducao(id) {
  const p = query('SELECT * FROM insumos WHERE id = ?', [id])[0];
  if (!p) return null;
  const itens = query(
    `SELECT pi.id, pi.quantidade, i.id as ingrediente_id, i.nome, i.unidade_compra, i.preco_unitario
     FROM producao_itens pi JOIN insumos i ON i.id = pi.ingrediente_id
     WHERE pi.producao_id = ? ORDER BY i.nome`, [id]
  );
  return { ...p, itens };
}
function addProducaoItem(producaoId, ingredienteId, quantidade) {
  if (!ingredienteId || !quantidade || quantidade <= 0) return;
  if (Number(ingredienteId) === Number(producaoId)) {
    alert('Uma producao interna nao pode usar a si mesma como ingrediente.');
    return;
  }
  run('INSERT INTO producao_itens (producao_id, ingrediente_id, quantidade) VALUES (?, ?, ?)', [producaoId, ingredienteId, quantidade]);
  recalcAllProducoesInternas();
}
function updateProducaoItemQtd(itemId, quantidade) {
  run('UPDATE producao_itens SET quantidade = ? WHERE id = ?', [quantidade, itemId]);
  recalcAllProducoesInternas();
}
function removeProducaoItem(itemId) {
  run('DELETE FROM producao_itens WHERE id = ?', [itemId]);
  recalcAllProducoesInternas();
}

// ---------- Receitas ----------
function getReceitas() {
  const receitas = query('SELECT * FROM receitas ORDER BY nome');
  return receitas.map((r) => ({ ...r, custo: calcCustoReceita(r.id) }));
}
function getReceita(id) {
  const r = query('SELECT * FROM receitas WHERE id = ?', [id])[0];
  if (!r) return null;
  const itens = query(
    `SELECT ri.id, ri.quantidade, i.id as insumo_id, i.nome, i.unidade_compra, i.preco_unitario
     FROM receita_itens ri JOIN insumos i ON i.id = ri.insumo_id
     WHERE ri.receita_id = ? ORDER BY i.nome`, [id]
  );
  return { ...r, itens };
}
function calcCustoReceita(receitaId) {
  const rows = query(
    `SELECT ri.quantidade, i.preco_unitario FROM receita_itens ri
     JOIN insumos i ON i.id = ri.insumo_id WHERE ri.receita_id = ?`, [receitaId]
  );
  return rows.reduce((sum, r) => sum + r.quantidade * r.preco_unitario, 0);
}
function addReceita() {
  const id = runInsert(`INSERT INTO receitas (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo)
       VALUES ('Nova receita', '', '', '', '', 0, 1, '', '', '', 0)`);
  openReceitaEditor(id);
}
function deleteReceita(id) {
  const usadoEvento = query('SELECT COUNT(*) as c FROM evento_receitas WHERE receita_id = ?', [id])[0].c;
  if (usadoEvento > 0) {
    alert('Esta ficha tecnica esta sendo usada em um ou mais eventos e nao pode ser excluida. Remova-a de la primeiro.');
    return;
  }
  if (!confirm('Excluir esta ficha tecnica?')) return;
  run('DELETE FROM receita_itens WHERE receita_id = ?', [id]);
  run('DELETE FROM receitas WHERE id = ?', [id]);
  closeReceitaEditor();
  refreshAll();
}
function updateReceitaField(id, field, value) {
  const allowed = ['nome', 'categoria', 'modo_preparo', 'copo', 'guarnicao', 'preco_venda', 'utensilios', 'tempo_preparo', 'rendimento', 'vendas_periodo'];
  setField('receitas', allowed, id, field, value);
}
function addReceitaItem(receitaId, insumoId, quantidade) {
  if (!insumoId || !quantidade || quantidade <= 0) return;
  run('INSERT INTO receita_itens (receita_id, insumo_id, quantidade) VALUES (?, ?, ?)', [receitaId, insumoId, quantidade]);
}
function updateReceitaItemQtd(itemId, quantidade) {
  run('UPDATE receita_itens SET quantidade = ? WHERE id = ?', [quantidade, itemId]);
}
function removeReceitaItem(itemId) {
  run('DELETE FROM receita_itens WHERE id = ?', [itemId]);
}

// ---------- Indicadores ----------
function calcIndicadores(custo, precoVenda) {
  const cmv = precoVenda > 0 ? (custo / precoVenda) * 100 : null;
  const markup = custo > 0 ? precoVenda / custo : null;
  const margem = precoVenda - custo;
  return { cmv, markup, margem };
}
function fmtMoeda(v) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtPct(v) {
  return v === null || v === undefined ? '-' : v.toFixed(1) + '%';
}
function cmvClass(cmv) {
  if (cmv === null) return '';
  if (cmv <= 25) return 'good';
  if (cmv <= 35) return 'warn';
  return 'bad';
}

// Engenharia de cardapio: cruza giro de vendas (popularidade) com margem (lucratividade)
// contra a media do proprio cardapio - classificacao classica em 4 quadrantes.
function computeMenuEngineering(todasReceitas = getReceitas()) {
  const receitas = todasReceitas.filter((r) => r.vendas_periodo > 0);
  if (!receitas.length) return null;
  const comMargem = receitas.map((r) => ({ ...r, margem: calcIndicadores(r.custo, r.preco_venda).margem }));
  const mediaVendas = comMargem.reduce((s, r) => s + r.vendas_periodo, 0) / comMargem.length;
  const mediaMargem = comMargem.reduce((s, r) => s + r.margem, 0) / comMargem.length;
  const quad = { estrela: [], cavalo: [], enigma: [], abacaxi: [] };
  for (const r of comMargem) {
    const popular = r.vendas_periodo >= mediaVendas;
    const lucrativo = r.margem >= mediaMargem;
    if (popular && lucrativo) quad.estrela.push(r);
    else if (popular && !lucrativo) quad.cavalo.push(r);
    else if (!popular && lucrativo) quad.enigma.push(r);
    else quad.abacaxi.push(r);
  }
  return quad;
}

// ---------- Eventos (pacotes) ----------
// Custo medio por dose entre os drinks selecionados, escalado por quantas
// doses cada convidado consome. Funcao pura - recebe os custos ja calculados
// em vez de buscar do banco, pra dar pra testar sem sql.js/localStorage.
function calcCustoEventoPessoa(custosDasReceitas, dosesPorPessoa) {
  if (!custosDasReceitas.length) return 0;
  const mediaCusto = custosDasReceitas.reduce((s, c) => s + c, 0) / custosDasReceitas.length;
  return mediaCusto * dosesPorPessoa;
}
function getEventos() {
  return query('SELECT * FROM eventos ORDER BY nome').map((e) => ({ ...e, custoPorPessoa: calcCustoEvento(e.id) }));
}
function getEvento(id) {
  const e = query('SELECT * FROM eventos WHERE id = ?', [id])[0];
  if (!e) return null;
  const receitas = query(
    `SELECT er.id as vinculo_id, r.id, r.nome
     FROM evento_receitas er JOIN receitas r ON r.id = er.receita_id
     WHERE er.evento_id = ? ORDER BY r.nome`, [id]
  ).map((r) => ({ ...r, custo: calcCustoReceita(r.id) }));
  return { ...e, receitas };
}
function addEvento() {
  const id = runInsert(`INSERT INTO eventos (nome, data, convidados, horas, doses_por_pessoa, preco_pacote_pessoa, ativo)
       VALUES ('Novo evento', '', 0, 0, 0, 0, 1)`);
  openEventoEditor(id);
}
function updateEventoField(id, field, value) {
  const allowed = ['nome', 'data', 'convidados', 'horas', 'doses_por_pessoa', 'preco_pacote_pessoa'];
  setField('eventos', allowed, id, field, value);
}
function deleteEvento(id) {
  if (!confirm('Excluir este evento?')) return;
  run('DELETE FROM evento_receitas WHERE evento_id = ?', [id]);
  run('DELETE FROM eventos WHERE id = ?', [id]);
  closeEventoEditor();
  refreshAll();
}
function addEventoReceita(eventoId, receitaId) {
  const jaExiste = query('SELECT id FROM evento_receitas WHERE evento_id = ? AND receita_id = ?', [eventoId, receitaId]).length > 0;
  if (jaExiste) return;
  run('INSERT INTO evento_receitas (evento_id, receita_id) VALUES (?, ?)', [eventoId, receitaId]);
}
function removeEventoReceita(vinculoId) {
  run('DELETE FROM evento_receitas WHERE id = ?', [vinculoId]);
}
function calcCustoEvento(eventoId) {
  const custos = query(
    `SELECT r.id FROM evento_receitas er JOIN receitas r ON r.id = er.receita_id WHERE er.evento_id = ?`,
    [eventoId]
  ).map((r) => calcCustoReceita(r.id));
  const evento = query('SELECT doses_por_pessoa FROM eventos WHERE id = ?', [eventoId])[0];
  return calcCustoEventoPessoa(custos, evento ? evento.doses_por_pessoa : 0);
}

// Exporta as funcoes puras pro test runner (Node). No browser `module` nao
// existe e este bloco nao roda - script tag continua funcionando igual.
if (typeof module !== 'undefined') {
  module.exports = { calcIndicadores, computeMenuEngineering, fmtMoeda, fmtPct, cmvClass, calcCustoEventoPessoa };
}
