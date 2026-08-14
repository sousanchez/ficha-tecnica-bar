// Camada de persistencia - SQLite via sql.js, salvo em localStorage (100% client-side)

const LS_KEY = 'ficha_tecnica_bar_db_v1';
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT DEFAULT 'Outros',
  casa TEXT,
  fornecedor TEXT,
  unidade_compra TEXT DEFAULT 'unidade',
  tamanho_unidade REAL DEFAULT 1,
  preco_compra REAL DEFAULT 0,
  preco_unitario REAL DEFAULT 0,
  data_atualizacao TEXT,
  tipo TEXT DEFAULT 'comprado',
  fator_correcao REAL DEFAULT 1,
  estoque_minimo REAL DEFAULT 0,
  estoque_atual REAL DEFAULT 0
);
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
CREATE TABLE IF NOT EXISTS receita_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receita_id INTEGER NOT NULL REFERENCES receitas(id) ON DELETE CASCADE,
  insumo_id INTEGER NOT NULL REFERENCES insumos(id),
  quantidade REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS producao_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producao_id INTEGER NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  ingrediente_id INTEGER NOT NULL REFERENCES insumos(id),
  quantidade REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  data TEXT DEFAULT '',
  convidados INTEGER DEFAULT 0,
  horas REAL DEFAULT 0,
  doses_por_pessoa REAL DEFAULT 0,
  preco_pacote_pessoa REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS evento_receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  receita_id INTEGER NOT NULL REFERENCES receitas(id)
);
`;

let SQL = null;
let db = null;

async function init() {
  SQL = await initSqlJs({ locateFile: (f) => `lib/${f}` });
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    const bytes = base64ToBytes(saved);
    db = new SQL.Database(bytes);
    db.run(SCHEMA_SQL);
    migrateSchema();
  } else {
    db = new SQL.Database();
    db.run(SCHEMA_SQL);
    seedInsumos();
    persist();
  }
  attachGlobalHandlers();
  renderAll();
}

// Bancos salvos por versoes anteriores do app podem nao ter as colunas novas.
function migrateSchema() {
  const addColIfMissing = (table, colDef) => {
    const colName = colDef.split(' ')[0];
    const cols = query(`PRAGMA table_info(${table})`).map((c) => c.name);
    if (!cols.includes(colName)) db.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  };
  addColIfMissing('insumos', "tipo TEXT DEFAULT 'comprado'");
  addColIfMissing('insumos', 'fator_correcao REAL DEFAULT 1');
  addColIfMissing('insumos', 'estoque_minimo REAL DEFAULT 0');
  addColIfMissing('insumos', 'estoque_atual REAL DEFAULT 0');
  addColIfMissing('receitas', "utensilios TEXT DEFAULT ''");
  addColIfMissing('receitas', "tempo_preparo TEXT DEFAULT ''");
  addColIfMissing('receitas', "rendimento TEXT DEFAULT ''");
  addColIfMissing('receitas', 'vendas_periodo REAL DEFAULT 0');
  addColIfMissing('receitas', 'markup_alvo REAL DEFAULT 0');
  db.run("UPDATE insumos SET tipo = 'comprado' WHERE tipo IS NULL");
  db.run('UPDATE insumos SET fator_correcao = 1 WHERE fator_correcao IS NULL');
  db.run('UPDATE insumos SET estoque_minimo = 0 WHERE estoque_minimo IS NULL');
  db.run('UPDATE insumos SET estoque_atual = 0 WHERE estoque_atual IS NULL');
  seedProducaoPropria();
  seedFichasFlorest();
  persist();
}

// Converte insumos "revisar" (comprado, preco 0) que na verdade sao
// producoes proprias da casa em producao_interna de verdade, com
// sub-receita. So converte o que ja existir pelo nome - se o banco nao
// passou pela populacao das fichas do Florest, e um no-op silencioso.
// Idempotente: cada parte checa o estado atual antes de agir, entao rodar
// de novo em um banco ja migrado nao duplica nada.
function seedProducaoPropria() {
  const buscarOuCriarInsumo = (nome, categoria, unidade_compra, tamanho_unidade, preco_compra) => {
    const existente = query('SELECT id FROM insumos WHERE nome = ?', [nome])[0];
    if (existente) return existente.id;
    const id = runInsert(`INSERT INTO insumos
      (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
      VALUES (?, ?, '', '', ?, ?, ?, 0, '', 'comprado', 1, 0, 0)`,
      [nome, categoria, unidade_compra, tamanho_unidade, preco_compra]);
    recalcInsumoUnitario(id);
    return id;
  };

  // Insumos ja existentes cadastrados como "unidade" (pacote inteiro) mas
  // que sao vendidos por peso - preco ja bate com pacote de 1kg, entao so
  // ajusta a base de calculo, preco fica igual.
  const corrigirUnidade = (nome, unidade, tamanho) => {
    const row = query('SELECT id, unidade_compra FROM insumos WHERE nome = ?', [nome])[0];
    if (!row || row.unidade_compra === unidade) return;
    updateInsumoField(row.id, 'unidade_compra', unidade);
    updateInsumoField(row.id, 'tamanho_unidade', tamanho);
  };
  corrigirUnidade('ACUCAR REFINADO', 'g', 1000);
  corrigirUnidade('SAL REFINADO', 'g', 1000);

  const idAcidoCitrico = buscarOuCriarInsumo('ACIDO CITRICO', 'Xarope/Bitter', 'g', 1000, 30.90);
  const idAcidoMalico = buscarOuCriarInsumo('ACIDO MALICO', 'Xarope/Bitter', 'g', 1000, 45.00);
  const idVinagreMaca = buscarOuCriarInsumo('VINAGRE DE MACA', 'Outros', 'ml', 1000, 19.98);
  const idChaDoAmor = buscarOuCriarInsumo('CHA DO AMOR (TALCHA)', 'Produção interna', 'g', 50, 79.00);
  const idSucoTangerina = buscarOuCriarInsumo('SUCO DE TANGERINA', 'Suco', 'ml', 1000, 0);

  // Converte um insumo "comprado" em producao_interna e grava os
  // ingredientes - so age se o insumo existir e ainda estiver como
  // "comprado" (depois de convertido, tipo muda e essa checagem falha
  // sozinha nas proximas execucoes).
  const converterEmProducao = (nome, tamanhoLote, unidadeLote, itens) => {
    const row = query("SELECT id FROM insumos WHERE nome = ? AND tipo = 'comprado'", [nome])[0];
    if (!row) return;
    run("UPDATE insumos SET tipo = 'producao_interna', unidade_compra = ?, tamanho_unidade = ? WHERE id = ?",
      [unidadeLote, tamanhoLote, row.id]);
    for (const [insumoId, quantidade] of itens) {
      if (!insumoId) continue; // insumo-base nao encontrado - pula esse item em vez de gravar id invalido
      run('INSERT INTO producao_itens (producao_id, ingrediente_id, quantidade) VALUES (?, ?, ?)', [row.id, insumoId, quantidade]);
    }
  };

  const idAcucar = query("SELECT id FROM insumos WHERE nome = 'ACUCAR REFINADO'")[0]?.id;
  const idAgua = query("SELECT id FROM insumos WHERE nome = 'AGUA FILTRADA'")[0]?.id;
  const idLimaoTahiti = query("SELECT id FROM insumos WHERE nome = 'LIMAO TAHITI'")[0]?.id;
  const idSal = query("SELECT id FROM insumos WHERE nome = 'SAL REFINADO'")[0]?.id;
  const idAbsolut = query("SELECT id FROM insumos WHERE nome = 'ABSOLUT 1L'")[0]?.id;

  if (idAcucar && idAgua) {
    converterEmProducao('XAROPE DE ACUCAR (SIMPLES)', 2000, 'ml', [[idAcucar, 1000], [idAgua, 1000]]);
  }
  if (idAgua && idLimaoTahiti && idAcucar && idSal) {
    converterEmProducao('SUPER SUCO', 10000, 'ml', [
      [idAgua, 10000], [idLimaoTahiti, 600], [idAcucar, 600], [idAcidoCitrico, 480], [idAcidoMalico, 240], [idSal, 20],
    ]);
  }
  const idXaropeAcucar = query("SELECT id FROM insumos WHERE nome = 'XAROPE DE ACUCAR (SIMPLES)'")[0]?.id;
  if (idSucoTangerina && idVinagreMaca && idXaropeAcucar) {
    converterEmProducao('SHRUB DE TANGERINA CLEMENTINA', 870, 'ml', [
      [idSucoTangerina, 600], [idVinagreMaca, 70], [idXaropeAcucar, 200],
    ]);
  }
  if (idAbsolut && idChaDoAmor) {
    converterEmProducao('VODKA COM CHA DO AMOR (TALCHA)', 1000, 'ml', [
      [idAbsolut, 1000], [idChaDoAmor, 15],
    ]);
  }

  recalcAllProducoesInternas();
}

// Cadastra as 10 fichas tecnicas (5 autorais + 5 classicos VV) do cardapio
// Florest do evento, junto com os insumos comprados que faltam e as
// sub-receitas de producao interna que elas usam. Idempotente: insumo,
// producao interna e receita so sao criados se ainda nao existir pelo nome -
// rodar de novo em um banco ja migrado nao duplica nada.
function seedFichasFlorest() {
  // Insumos comprados novos, com preco estimado (marcado 'EST' em
  // data_atualizacao ate o valor real de compra ser conferido).
  const buscarOuCriarInsumoEst = (nome, categoria, unidade_compra, tamanho_unidade, preco_compra) => {
    const existente = query('SELECT id FROM insumos WHERE nome = ?', [nome])[0];
    if (existente) return existente.id;
    const id = runInsert(`INSERT INTO insumos
      (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
      VALUES (?, ?, '', '', ?, ?, ?, 0, 'EST', 'comprado', 1, 0, 0)`,
      [nome, categoria, unidade_compra, tamanho_unidade, preco_compra]);
    recalcInsumoUnitario(id);
    return id;
  };

  buscarOuCriarInsumoEst('NIB GIN (PERA)', 'Gin', 'ml', 750, 120.00);
  buscarOuCriarInsumoEst('DRACO NEROLI GIN', 'Gin', 'ml', 750, 140.00);
  buscarOuCriarInsumoEst('DRACO LONDON DRY', 'Gin', 'ml', 750, 130.00);
  buscarOuCriarInsumoEst('JACK DANIEL´S APPLE 1L', 'Whisky', 'ml', 1000, 110.00);
  buscarOuCriarInsumoEst('SCOTCH WHITE HORSE 1L', 'Whisky', 'ml', 1000, 70.00);
  buscarOuCriarInsumoEst('ALEXANDRION 7 BRANDY 1L', 'Conhaque/Brandy', 'ml', 1000, 65.00);
  buscarOuCriarInsumoEst('LICOR DE CAFE SCHLUCK 900ML', 'Licor/Aperitivo', 'ml', 900, 30.00);
  buscarOuCriarInsumoEst('LICOR 43 700ML', 'Licor/Aperitivo', 'ml', 700, 130.00);
  buscarOuCriarInsumoEst('MARTINI BIANCO 1L', 'Licor/Aperitivo', 'ml', 1000, 45.00);
  buscarOuCriarInsumoEst('VERMUTE ROSSO 1L', 'Licor/Aperitivo', 'ml', 1000, 42.00);
  buscarOuCriarInsumoEst('AGUA TONICA 1,5L', 'Água', 'ml', 1500, 9.00);
  buscarOuCriarInsumoEst('ESPUMANTE BRUT 750ML', 'Outros', 'ml', 750, 35.00);
  buscarOuCriarInsumoEst('PURE DE PESSEGO FABBRI', 'Suco', 'g', 1300, 95.00);
  buscarOuCriarInsumoEst('CLARA DE OVO PASTEURIZADA', 'Outros', 'ml', 1000, 22.00);
  buscarOuCriarInsumoEst('GENGIBRE', 'Hortifruti', 'g', 1000, 9.00);
  buscarOuCriarInsumoEst('CAPIM SANTO', 'Hortifruti', 'g', 1000, 20.00);
  buscarOuCriarInsumoEst('LIMAO SICILIANO', 'Hortifruti', 'unidade', 1, 2.50);
  buscarOuCriarInsumoEst('HORTELA', 'Hortifruti', 'g', 100, 6.00);
  buscarOuCriarInsumoEst('AGUA COM GAS 1,5L', 'Água', 'ml', 1500, 4.50);
  buscarOuCriarInsumoEst('BITTER DE LARANJA', 'Xarope/Bitter', 'ml', 200, 45.00);
  buscarOuCriarInsumoEst('BITTER DE CHOCOLATE', 'Xarope/Bitter', 'ml', 200, 45.00);
  buscarOuCriarInsumoEst('SOLUCAO SALINA', 'Outros', 'ml', 200, 5.00);
  buscarOuCriarInsumoEst('LIMAO TAHITI', 'Hortifruti', 'ml', 1000, 15.00);
  buscarOuCriarInsumoEst('AGUA FILTRADA', 'Água', 'ml', 1000, 0.00);

  // NIB BITTER ja existia cadastrado como "unidade" (preco real R$69,90 do
  // pacote) mas e usado em ml nas receitas - so corrige a base de calculo,
  // preco de compra fica o mesmo.
  const rowNib = query("SELECT id, unidade_compra FROM insumos WHERE nome = 'NIB BITTER'")[0];
  if (rowNib && rowNib.unidade_compra !== 'ml') {
    run("UPDATE insumos SET unidade_compra = 'ml', tamanho_unidade = 100, data_atualizacao = 'EST' WHERE id = ?", [rowNib.id]);
    recalcInsumoUnitario(rowNib.id);
  }

  // MARACUJA POLPA ja existia cadastrado como "unidade" (preco 0, revisar) -
  // na verdade e vendido por peso. So corrige se ainda nao foi corrigido.
  const rowMaracuja = query("SELECT id, unidade_compra FROM insumos WHERE nome = 'MARACUJA POLPA'")[0];
  if (rowMaracuja && rowMaracuja.unidade_compra !== 'g') {
    run("UPDATE insumos SET unidade_compra = 'g', tamanho_unidade = 1000, preco_compra = 18.00, data_atualizacao = 'EST' WHERE id = ?", [rowMaracuja.id]);
    recalcInsumoUnitario(rowMaracuja.id);
  }

  const idPorNome = (nome) => query('SELECT id FROM insumos WHERE nome = ?', [nome])[0]?.id;

  // Sub-receitas de producao interna - criadas do zero ja como
  // producao_interna, sem precisar de um insumo "revisar" previo (diferente
  // de converterEmProducao, usada em seedProducaoPropria). As 4 primeiras
  // espelham as sub-receitas da seedProducaoPropria: no banco real elas nao
  // foram criadas la porque LIMAO TAHITI/AGUA FILTRADA ainda nao existiam
  // (so passam a existir aqui em cima) - por isso sao recriadas aqui. As
  // demais (gengibre/capim) sao novas. Quantidades EST a calibrar com o bar.
  const criarProducaoInterna = (nome, tamanhoLote, unidadeLote, itens) => {
    if (query('SELECT id FROM insumos WHERE nome = ?', [nome])[0]) return; // ja existe, nao recria
    const id = runInsert(`INSERT INTO insumos
      (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
      VALUES (?, 'Produção interna', '', '', ?, ?, 0, 0, '', 'producao_interna', 1, 0, 0)`,
      [nome, unidadeLote, tamanhoLote]);
    for (const [nomeIngrediente, quantidade] of itens) {
      const ingredienteId = idPorNome(nomeIngrediente);
      if (!ingredienteId) continue; // insumo-base nao encontrado - pula esse item em vez de gravar id invalido
      run('INSERT INTO producao_itens (producao_id, ingrediente_id, quantidade) VALUES (?, ?, ?)', [id, ingredienteId, quantidade]);
    }
  };

  criarProducaoInterna('XAROPE DE ACUCAR (SIMPLES)', 2000, 'ml', [
    ['ACUCAR REFINADO', 1000], ['AGUA FILTRADA', 1000],
  ]);
  criarProducaoInterna('SUPER SUCO', 10000, 'ml', [
    ['AGUA FILTRADA', 10000], ['LIMAO TAHITI', 600], ['ACUCAR REFINADO', 600],
    ['ACIDO CITRICO', 480], ['ACIDO MALICO', 240], ['SAL REFINADO', 20],
  ]);
  criarProducaoInterna('SHRUB DE TANGERINA CLEMENTINA', 870, 'ml', [
    ['SUCO DE TANGERINA', 600], ['VINAGRE DE MACA', 70], ['XAROPE DE ACUCAR (SIMPLES)', 200],
  ]);
  criarProducaoInterna('VODKA COM CHA DO AMOR (TALCHA)', 1000, 'ml', [
    ['ABSOLUT 1L', 1000], ['CHA DO AMOR (TALCHA)', 15],
  ]);
  criarProducaoInterna('XAROPE DE GENGIBRE', 1000, 'ml', [
    ['GENGIBRE', 200], ['ACUCAR REFINADO', 500], ['AGUA FILTRADA', 500],
  ]); // EST a calibrar
  criarProducaoInterna('ESPUMA DE GENGIBRE', 1000, 'ml', [
    ['XAROPE DE GENGIBRE', 600], ['CLARA DE OVO PASTEURIZADA', 400],
  ]); // EST a calibrar
  criarProducaoInterna('XAROPE DE CAPIM SANTO', 1000, 'ml', [
    ['CAPIM SANTO', 100], ['AGUA FILTRADA', 1000],
  ]); // EST a calibrar

  recalcAllProducoesInternas();

  // As 10 fichas tecnicas do cardapio Florest (5 autorais + 5 classicos VV),
  // conforme a ficha tecnica oficial. preco_venda/markup_alvo ficam 0 - o
  // usuario preenche depois. Autorais recebem vendas_periodo planejado (mix
  // do pacote); classicos ficam com vendas_periodo 0 (open bar).
  const criarReceita = (nome, categoria, modo_preparo, copo, guarnicao, itens, vendasPeriodo = 0) => {
    if (query('SELECT id FROM receitas WHERE nome = ?', [nome])[0]) return; // ja existe, nao recria
    const receitaId = runInsert(`INSERT INTO receitas
      (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo)
      VALUES (?, ?, ?, ?, ?, 0, 1, '', '', '', ?, 0)`,
      [nome, categoria, modo_preparo, copo, guarnicao, vendasPeriodo]);
    for (const [nomeInsumo, quantidade] of itens) {
      const insumoId = idPorNome(nomeInsumo);
      if (!insumoId) continue; // insumo nao encontrado - pula esse item em vez de gravar id invalido
      run('INSERT INTO receita_itens (receita_id, insumo_id, quantidade) VALUES (?, ?, ?)', [receitaId, insumoId, quantidade]);
    }
  };

  criarReceita('Clareira', 'Autoral Florest', 'Montado', 'Taça de vinho branco', 'Gomo de tangerina', [
    ['VODKA COM CHA DO AMOR (TALCHA)', 30], ['SHRUB DE TANGERINA CLEMENTINA', 10], ['MARTINI BIANCO 1L', 20],
    ['PURE DE PESSEGO FABBRI', 20], ['SUPER SUCO', 10], ['AGUA FILTRADA', 27],
  ], 200);
  criarReceita('Jardim', 'Autoral Florest', 'Batido', 'Coupé', 'Zest siciliano', [
    ['DRACO NEROLI GIN', 45], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['SUPER SUCO', 15], ['HORTELA', 5],
    ['XAROPE DE CAPIM SANTO', 5], ['AGUA COM GAS 1,5L', 10], ['SOLUCAO SALINA', 1],
  ], 150);
  criarReceita('Pomar', 'Autoral Florest', 'Batido', 'Old-fashioned', 'Lâmina de maçã verde', [
    ['JACK DANIEL´S APPLE 1L', 30], ['SCOTCH WHITE HORSE 1L', 15], ['SUPER SUCO', 15],
    ['XAROPE DE ACUCAR (SIMPLES)', 15], ['CLARA DE OVO PASTEURIZADA', 30], ['BITTER DE LARANJA', 1],
  ], 150);
  criarReceita('Refúgio', 'Autoral Florest', 'Batido', 'Old-fashioned / gelão', 'Zest siciliano', [
    ['NIB GIN (PERA)', 45], ['XAROPE DE ACUCAR (SIMPLES)', 30], ['SUPER SUCO', 25], ['NIB BITTER', 1.5],
  ], 150);
  criarReceita('Encanto', 'Autoral Florest', 'Mexido', 'Old-fashioned / gelão', 'Zest laranja', [
    ['JACK DANIEL´S 1L', 30], ['ALEXANDRION 7 BRANDY 1L', 30], ['LIMAO TAHITI', 15],
    ['LICOR DE CAFE SCHLUCK 900ML', 5], ['LICOR 43 700ML', 5], ['BITTER DE CHOCOLATE', 1.5],
  ], 100);
  criarReceita('Spritz Veneziano', 'Clássico VV', 'Montado (base à escolha; custeado com Aperol)', 'Taça de vinho branco', 'Gomo de laranja/limão', [
    ['APEROL 750 ML', 60], ['ESPUMANTE BRUT 750ML', 90], ['AGUA COM GAS 1,5L', 20],
  ]);
  criarReceita('Mango Passion', 'Clássico VV', 'Batido', 'Coupé', 'Semente de maracujá', [
    ['ABSOLUT 1L', 30], ['SUCO CONCENTRADO MANGA MAGUARY 500ML', 30], ['SUPER SUCO', 15],
    ['XAROPE DE ACUCAR (SIMPLES)', 15], ['ESPUMA DE GENGIBRE', 60], ['MARACUJA POLPA', 5],
  ]);
  criarReceita('Negroni', 'Clássico VV', 'Mexido', 'Old-fashioned / gelão', 'Zest laranja', [
    ['DRACO LONDON DRY', 30], ['CAMPARI 998 ML', 30], ['VERMUTE ROSSO 1L', 30],
  ]);
  criarReceita('Fitzgerald', 'Clássico VV', 'Batido', 'Old-fashioned / gelão', 'Zest siciliano', [
    ['DRACO LONDON DRY', 45], ['SUPER SUCO', 15], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['NIB BITTER', 1.5],
  ]);
  criarReceita('Gin Tônica', 'Clássico VV', 'Montado', 'Taça baloon', 'Zest siciliano', [
    ['DRACO LONDON DRY', 60], ['AGUA TONICA 1,5L', 120], ['LIMAO TAHITI', 3],
  ]);

  recalcAllProducoesInternas();
}

function seedInsumos() {
  if (typeof SEED_INSUMOS === 'undefined') return;
  const stmt = db.prepare(`INSERT INTO insumos
    (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'comprado', 1, 0, 0)`);
  for (const it of SEED_INSUMOS) {
    const tamanho = it.tamanho_unidade > 0 ? it.tamanho_unidade : 1;
    const precoUnitario = it.preco_compra / tamanho;
    stmt.run([it.nome, it.categoria, it.casa, it.fornecedor, it.unidade_compra, tamanho, it.preco_compra, precoUnitario, it.data_atualizacao]);
  }
  stmt.free();
}

function persist() {
  try {
    const bytes = db.export();
    localStorage.setItem(LS_KEY, bytesToBase64(bytes));
  } catch (err) {
    alert('Não foi possível salvar as alterações no navegador (armazenamento cheio ou indisponível). Exporte o banco (.db) agora para não perder o trabalho.');
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function query(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((row) => Object.fromEntries(row.map((v, i) => [columns[i], v])));
}
function run(sql, params = []) {
  db.run(sql, params);
  persist();
}
// Unico ponto do app que interpola nome de coluna em SQL - so roda se `field`
// bater com a whitelist do chamador, entao nunca recebe entrada nao validada.
function setField(table, allowedFields, id, field, value) {
  if (!allowedFields.includes(field)) return false;
  run(`UPDATE ${table} SET ${field} = ? WHERE id = ?`, [value, id]);
  return true;
}
// db.export() (chamado por persist) reseta o last_insert_rowid() do sql.js,
// entao o id precisa ser lido ANTES de persistir.
function runInsert(sql, params = []) {
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  persist();
  return id;
}

// ---------- Export / Import DB ----------
function exportDb() {
  const bytes = db.export();
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ficha_tecnica_bar.db';
  a.click();
  URL.revokeObjectURL(url);
}
function importDb(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const dbAnterior = db;
    try {
      const bytes = new Uint8Array(reader.result);
      const novoDb = new SQL.Database(bytes);
      novoDb.run(SCHEMA_SQL); // lanca erro se o arquivo nao for um banco SQLite valido
      db = novoDb;
      migrateSchema();
      persist();
      renderAll();
      alert('Banco de dados importado com sucesso.');
    } catch (err) {
      db = dbAnterior;
      alert(`Não foi possível importar "${file.name}": o arquivo não parece ser um banco de dados válido.\n\nSeus dados atuais não foram alterados.`);
    }
  };
  reader.onerror = () => {
    alert(`Não foi possível ler o arquivo "${file.name}".`);
  };
  reader.readAsArrayBuffer(file);
}
