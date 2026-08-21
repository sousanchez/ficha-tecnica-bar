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
  ativo INTEGER DEFAULT 1,
  estagio TEXT DEFAULT 'lead'
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
    // Navegador/dispositivo novo (sem localStorage): comeca com o mesmo
    // cardapio ja cadastrado no codigo (insumos + fichas tecnicas), pra ficar
    // igual em qualquer lugar que o app for aberto pela primeira vez.
    db = new SQL.Database();
    db.run(SCHEMA_SQL);
    seedInsumos();
    seedProducaoPropria();
    seedFichasFlorest();
    seedFichasOlivio();
    persistLocalOnly();
  }
  attachGlobalHandlers();
  renderAll();
  initCloudSync();
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
  addColIfMissing('eventos', "estagio TEXT DEFAULT 'lead'");
  db.run("UPDATE insumos SET tipo = 'comprado' WHERE tipo IS NULL");
  db.run('UPDATE insumos SET fator_correcao = 1 WHERE fator_correcao IS NULL');
  db.run('UPDATE insumos SET estoque_minimo = 0 WHERE estoque_minimo IS NULL');
  db.run('UPDATE insumos SET estoque_atual = 0 WHERE estoque_atual IS NULL');
  db.run("UPDATE eventos SET estagio = 'lead' WHERE estagio IS NULL");
  seedProducaoPropria();
  seedFichasFlorest();
  seedFichasOlivio();
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

// Cadastra as fichas tecnicas do "cardapio Olivio" - planilha de referencia de
// coqueteis classicos e modernos (Death & Co / Cocktail Codex style), filtrada
// pra fora tecnica de laboratorio (dry ice, tinta de lula) e receitas tematicas
// experimentais sem aplicacao real num bar de evento. Precos de insumos novos
// pesquisados no mercado brasileiro (marcados 'EST' - a conferir com o bar real).
// Idempotente: insumo, producao interna e receita so sao criados/recriados se
// ainda nao existirem pelo nome - rodar de novo em um banco ja migrado nao duplica nada.

// Cadastra as fichas tecnicas do "cardapio Olivio" - planilha de referencia de
// coqueteis classicos e modernos (Death & Co / Cocktail Codex style), filtrada
// pra fora tecnica de laboratorio (dry ice, tinta de lula) e receitas tematicas
// experimentais sem aplicacao real num bar de evento. Precos de insumos novos
// pesquisados no mercado brasileiro (marcados 'EST' - a conferir com o bar real).
// Idempotente: insumo, producao interna e receita so sao criados/recriados se
// ainda nao existirem pelo nome - rodar de novo em um banco ja migrado nao duplica nada.
function seedFichasOlivio() {
  const buscarOuCriarInsumoOlivio = (nome, categoria, unidade_compra, tamanho_unidade, preco_compra) => {
    const existente = query('SELECT id FROM insumos WHERE nome = ?', [nome])[0];
    if (existente) return existente.id;
    const id = runInsert(`INSERT INTO insumos
      (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
      VALUES (?, ?, '', '', ?, ?, ?, 0, 'EST', 'comprado', 1, 0, 0)`,
      [nome, categoria, unidade_compra, tamanho_unidade, preco_compra]);
    recalcInsumoUnitario(id);
    return id;
  };

  // GARRAFÃO VINHO TINTO/BRANCO ja existiam cadastrados como "unidade" (preco
  // real R$41,90 do garrafao) mas sao usados em ml nas receitas abaixo - so
  // corrige a base de calculo pro tamanho padrao de garrafao (4,6L), preco
  // de compra fica o mesmo.
  const corrigirUnidadeOlivio = (nome, unidade, tamanho) => {
    const row = query('SELECT id, unidade_compra FROM insumos WHERE nome = ?', [nome])[0];
    if (!row || row.unidade_compra === unidade) return;
    updateInsumoField(row.id, 'unidade_compra', unidade);
    updateInsumoField(row.id, 'tamanho_unidade', tamanho);
  };
  corrigirUnidadeOlivio('GARRAFÃO VINHO TINTO', 'ml', 4600);
  corrigirUnidadeOlivio('GARRAFÃO VINHO BRANCO', 'ml', 4600);

  // ---------- Insumos comprados novos (pesquisados no mercado BR) ----------
  buscarOuCriarInsumoOlivio('LICOR AMARETTO DISARONNO 700ML', 'Licor/Aperitivo', 'ml', 700, 170);
  buscarOuCriarInsumoOlivio('BOURBON JIM BEAM WHITE 1L', 'Whisky', 'ml', 1000, 130);
  buscarOuCriarInsumoOlivio('SUCO DE LIMAO SICILIANO (ESPREMIDO)', 'Hortifruti', 'ml', 1000, 15);
  buscarOuCriarInsumoOlivio('SHRUB DE MARACUJA', 'Xarope/Bitter', 'ml', 500, 50);
  buscarOuCriarInsumoOlivio('VODKA ABSOLUT VANILIA 1L', 'Vodka', 'ml', 1000, 95);
  buscarOuCriarInsumoOlivio('LICOR KAHLUA CAFE 750ML', 'Licor/Aperitivo', 'ml', 750, 140);
  buscarOuCriarInsumoOlivio('AGUA COM GAS 1,5L', 'Água', 'ml', 1500, 4.5);
  buscarOuCriarInsumoOlivio('CACHACA AMBURANA 700ML', 'Cachaça', 'ml', 700, 80);
  buscarOuCriarInsumoOlivio('SUCO DE TOMATE', 'Suco', 'ml', 1000, 10);
  buscarOuCriarInsumoOlivio('LICOR CREME DE MURE (AMORA) 700ML', 'Licor/Aperitivo', 'ml', 700, 110);
  buscarOuCriarInsumoOlivio('TRIPLE SEC COINTREAU 700ML', 'Licor/Aperitivo', 'ml', 700, 175);
  buscarOuCriarInsumoOlivio('SUCO DE CRANBERRY', 'Suco', 'ml', 1000, 25);
  buscarOuCriarInsumoOlivio('RUM BRANCO BACARDI 980ML', 'Rum', 'ml', 980, 45);
  buscarOuCriarInsumoOlivio('RUM SPICED CAPTAIN MORGAN 750ML', 'Rum', 'ml', 750, 90);
  buscarOuCriarInsumoOlivio('GINGER ALE LATA 350ML', 'Refrigerante', 'ml', 350, 6);
  buscarOuCriarInsumoOlivio('ANGOSTURA BITTERS 200ML', 'Xarope/Bitter', 'ml', 200, 189);
  buscarOuCriarInsumoOlivio('TEQUILA PRATA JOSE CUERVO 750ML', 'Tequila', 'ml', 750, 130);
  buscarOuCriarInsumoOlivio('REFRIGERANTE DE GRAPEFRUIT (SODA)', 'Refrigerante', 'ml', 350, 6);
  buscarOuCriarInsumoOlivio('VERMUTE DRY MARTINI EXTRA DRY 750ML', 'Vermute/Conhaque', 'ml', 750, 47);
  buscarOuCriarInsumoOlivio('AGUA DE AZEITONA (SALMOURA)', 'Outros', 'ml', 500, 15);
  buscarOuCriarInsumoOlivio('AZEITONA VERDE', 'Hortifruti', 'unidade', 1, 1);
  buscarOuCriarInsumoOlivio('CAFE ESPRESSO (DOSE)', 'Café', 'ml', 30, 1.5);
  buscarOuCriarInsumoOlivio('SOLUCAO SALINA', 'Outros', 'ml', 200, 5);
  buscarOuCriarInsumoOlivio('FERNET BRANCA 1L', 'Licor/Aperitivo', 'ml', 1000, 130);
  buscarOuCriarInsumoOlivio('SUCO DE GRAPEFRUIT (ESPREMIDO)', 'Suco', 'ml', 1000, 20);
  buscarOuCriarInsumoOlivio('LICOR MARASCHINO LUXARDO 750ML', 'Licor/Aperitivo', 'ml', 750, 270);
  buscarOuCriarInsumoOlivio('KIWI', 'Hortifruti', 'unidade', 1, 2.5);
  buscarOuCriarInsumoOlivio('PISCO 750ML', 'Outros', 'ml', 750, 130);
  buscarOuCriarInsumoOlivio('LICOR DE KIWI 700ML', 'Licor/Aperitivo', 'ml', 700, 100);
  buscarOuCriarInsumoOlivio('LICOR DRAMBUIE 700ML', 'Licor/Aperitivo', 'ml', 700, 160);
  buscarOuCriarInsumoOlivio('CACHACA PRATA 965ML', 'Cachaça', 'ml', 965, 25);
  buscarOuCriarInsumoOlivio('SUCO DE LARANJA (ESPREMIDA)', 'Suco', 'ml', 1000, 12);
  buscarOuCriarInsumoOlivio('LARANJA', 'Hortifruti', 'unidade', 1, 2);
  buscarOuCriarInsumoOlivio('AMARO GENERICO 700ML', 'Licor/Aperitivo', 'ml', 700, 180);
  buscarOuCriarInsumoOlivio('MAKGEOLLI (VINHO DE ARROZ) 750ML', 'Outros', 'ml', 750, 45);
  buscarOuCriarInsumoOlivio('LICOR FRANGELICO (AVELA) 700ML', 'Licor/Aperitivo', 'ml', 700, 150);
  buscarOuCriarInsumoOlivio('AGUA TONICA 1,5L', 'Água', 'ml', 1500, 9);
  buscarOuCriarInsumoOlivio('SINGLE MALT SCOTCH GENERICO 700ML', 'Whisky', 'ml', 700, 250);
  buscarOuCriarInsumoOlivio('SAKE 720ML', 'Outros', 'ml', 720, 60);
  buscarOuCriarInsumoOlivio('SUCO DE PIMENTAO AMARELO', 'Suco', 'ml', 1000, 15);
  buscarOuCriarInsumoOlivio('LICOR DE DAMASCO (APRICOT BRANDY) 700ML', 'Licor/Aperitivo', 'ml', 700, 110);
  buscarOuCriarInsumoOlivio('LICOR ST GERMAIN (SABUGUEIRO) 700ML', 'Licor/Aperitivo', 'ml', 700, 280);
  buscarOuCriarInsumoOlivio('UVA NIAGARA', 'Hortifruti', 'g', 1000, 12);
  buscarOuCriarInsumoOlivio('APERITIVO VINHO FORTIFICADO GENERICO 750ML', 'Vermute/Conhaque', 'ml', 750, 180);
  buscarOuCriarInsumoOlivio('PEPINO', 'Hortifruti', 'unidade', 1, 3);
  buscarOuCriarInsumoOlivio('LICOR BENEDICTINE DOM 700ML', 'Licor/Aperitivo', 'ml', 700, 220);
  buscarOuCriarInsumoOlivio('ORANGE BITTERS 148ML', 'Xarope/Bitter', 'ml', 148, 150);
  buscarOuCriarInsumoOlivio('LICOR CREME DE CASSIS 700ML', 'Licor/Aperitivo', 'ml', 700, 110);
  buscarOuCriarInsumoOlivio('AGUA DE FLOR DE LARANJEIRA 250ML', 'Outros', 'ml', 250, 35);
  buscarOuCriarInsumoOlivio('TEQUILA REPOSADO 750ML', 'Tequila', 'ml', 750, 180);
  buscarOuCriarInsumoOlivio('MEZCAL 750ML', 'Outros', 'ml', 750, 150);
  buscarOuCriarInsumoOlivio('CEREJA MARASCHINO (POTE)', 'Outros', 'g', 200, 25);
  buscarOuCriarInsumoOlivio('PEYCHAUD\'S BITTERS 148ML', 'Xarope/Bitter', 'ml', 148, 160);
  buscarOuCriarInsumoOlivio('RYE WHISKEY BULLEIT 1L', 'Whisky', 'ml', 1000, 180);
  buscarOuCriarInsumoOlivio('LIMAO SICILIANO', 'Hortifruti', 'unidade', 1, 2.5);
  buscarOuCriarInsumoOlivio('CALVADOS (BRANDY DE MACA) 700ML', 'Conhaque/Brandy', 'ml', 700, 180);
  buscarOuCriarInsumoOlivio('WHISKEY IRLANDES JAMESON 1L', 'Whisky', 'ml', 1000, 120);
  buscarOuCriarInsumoOlivio('GELEIA DE LARANJA (MARMALADE)', 'Outros', 'g', 280, 18);
  buscarOuCriarInsumoOlivio('ABSINTHE 700ML', 'Licor/Aperitivo', 'ml', 700, 250);
  buscarOuCriarInsumoOlivio('LICOR CHARTREUSE GREEN 700ML', 'Licor/Aperitivo', 'ml', 700, 400);
  buscarOuCriarInsumoOlivio('RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 'Rum', 'ml', 750, 190);
  buscarOuCriarInsumoOlivio('RUM OVERPROOF 151 750ML', 'Rum', 'ml', 750, 140);
  buscarOuCriarInsumoOlivio('XAROPE DE COCO MONIN 700ML', 'Xarope/Bitter', 'ml', 700, 70);
  buscarOuCriarInsumoOlivio('LICOR ALLSPICE DRAM 700ML', 'Licor/Aperitivo', 'ml', 700, 150);
  buscarOuCriarInsumoOlivio('LICOR CHARTREUSE YELLOW 700ML', 'Licor/Aperitivo', 'ml', 700, 400);
  buscarOuCriarInsumoOlivio('OVO INTEIRO', 'Outros', 'unidade', 1, 1);
  buscarOuCriarInsumoOlivio('LICOR DE PESSEGO 700ML', 'Licor/Aperitivo', 'ml', 700, 100);
  buscarOuCriarInsumoOlivio('XAROPE DE BORDO (MAPLE SYRUP) 250ML', 'Xarope/Bitter', 'ml', 250, 45);
  buscarOuCriarInsumoOlivio('SHERRY FINO 750ML', 'Vinho/Espumante', 'ml', 750, 100);
  buscarOuCriarInsumoOlivio('LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 'Licor/Aperitivo', 'ml', 700, 110);
  buscarOuCriarInsumoOlivio('CREME DE LEITE FRESCO', 'Outros', 'ml', 1000, 25);
  buscarOuCriarInsumoOlivio('FRAMBOESA (POTE)', 'Hortifruti', 'g', 200, 25);
  buscarOuCriarInsumoOlivio('LICOR PIMM\'S NO.1 700ML', 'Licor/Aperitivo', 'ml', 700, 140);
  buscarOuCriarInsumoOlivio('LICOR COMBIER TRIPLE SEC 700ML', 'Licor/Aperitivo', 'ml', 700, 200);
  buscarOuCriarInsumoOlivio('LICOR CHERRY HEERING 700ML', 'Licor/Aperitivo', 'ml', 700, 180);
  buscarOuCriarInsumoOlivio('WHISKY CANADENSE 1L', 'Whisky', 'ml', 1000, 110);
  buscarOuCriarInsumoOlivio('OLEO-SACCHARUM DE LIMAO SICILIANO', 'Xarope/Bitter', 'ml', 500, 40);
  buscarOuCriarInsumoOlivio('LICOR BAILEY´S 750ML', 'Licor/Aperitivo', 'ml', 750, 110);
  buscarOuCriarInsumoOlivio('LICOR GRAND MARNIER 700ML', 'Licor/Aperitivo', 'ml', 700, 220);
  buscarOuCriarInsumoOlivio('LICOR MIDORI (MELAO) 700ML', 'Licor/Aperitivo', 'ml', 700, 130);
  buscarOuCriarInsumoOlivio('LICOR DE FRAMBOESA 700ML', 'Licor/Aperitivo', 'ml', 700, 110);
  buscarOuCriarInsumoOlivio('LIMAO PG', 'Outros', 'g', 100, 15);
  buscarOuCriarInsumoOlivio('SABORIZANTE MELAO', 'Outros', 'g', 100, 15);
  buscarOuCriarInsumoOlivio('CHA MATE 1 7 5', 'Outros', 'g', 100, 15);
  buscarOuCriarInsumoOlivio('GUARANA', 'Outros', 'g', 100, 15);
  buscarOuCriarInsumoOlivio('SOLUCAO ACIDO MALICO 6', 'Outros', 'g', 100, 15);
  buscarOuCriarInsumoOlivio('PO DE MORANGO', 'Outros', 'g', 100, 15);
  buscarOuCriarInsumoOlivio('ACUCAR DEMERARA', 'Outros', 'g', 1000, 12);
  buscarOuCriarInsumoOlivio('LEITE DE AMENDOA', 'Outros', 'ml', 1000, 18);
  buscarOuCriarInsumoOlivio('SUCO DE ROMA (GRANADINA)', 'Suco', 'ml', 1000, 35);
  buscarOuCriarInsumoOlivio('AMENDOA', 'Outros', 'g', 500, 30);
  buscarOuCriarInsumoOlivio('CANELA EM PAU', 'Outros', 'g', 100, 15);
  buscarOuCriarInsumoOlivio('MEL DE AGAVE', 'Outros', 'ml', 330, 35);

  const idPorNome = (nome) => query('SELECT id FROM insumos WHERE nome = ?', [nome])[0]?.id;

  const criarProducaoInternaOlivio = (nome, tamanhoLote, unidadeLote, itens) => {
    if (query('SELECT id FROM insumos WHERE nome = ?', [nome])[0]) return;
    const id = runInsert(`INSERT INTO insumos
      (nome, categoria, casa, fornecedor, unidade_compra, tamanho_unidade, preco_compra, preco_unitario, data_atualizacao, tipo, fator_correcao, estoque_minimo, estoque_atual)
      VALUES (?, 'Produção interna', '', '', ?, ?, 0, 0, '', 'producao_interna', 1, 0, 0)`,
      [nome, unidadeLote, tamanhoLote]);
    for (const [nomeIngrediente, quantidade] of itens) {
      const ingredienteId = idPorNome(nomeIngrediente);
      if (!ingredienteId) continue;
      run('INSERT INTO producao_itens (producao_id, ingrediente_id, quantidade) VALUES (?, ?, ?)', [id, ingredienteId, quantidade]);
    }
  };

  // ---------- Producoes internas (xaropes usados pelas receitas abaixo) ----------
  criarProducaoInternaOlivio('XAROPE DE ABACAXI (GOMME)', 1000, 'ml', [['POLPA ABACAXI', 500], ['ACUCAR REFINADO', 500]]);
  criarProducaoInternaOlivio('XAROPE DE AGAVE', 1000, 'ml', [['MEL DE AGAVE', 700], ['AGUA FILTRADA', 300]]);
  criarProducaoInternaOlivio('XAROPE DE CANELA', 1000, 'ml', [['ACUCAR REFINADO', 500], ['AGUA FILTRADA', 500], ['CANELA EM PAU', 20]]);
  criarProducaoInternaOlivio('XAROPE DE MEL (1:1)', 2000, 'ml', [['MEL ISIS POTE 1KG', 1000], ['AGUA FILTRADA', 1000]]);
  criarProducaoInternaOlivio('XAROPE DE MEL (2:1)', 1500, 'ml', [['MEL ISIS POTE 1KG', 1000], ['AGUA FILTRADA', 500]]);
  criarProducaoInternaOlivio('XAROPE DE RUIBARBO', 1000, 'ml', [['ACUCAR REFINADO', 500], ['AGUA FILTRADA', 500]]);
  criarProducaoInternaOlivio('XAROPE DE TANGERINA', 1000, 'ml', [['SUCO DE TANGERINA', 700], ['ACUCAR REFINADO', 300]]);
  criarProducaoInternaOlivio('XAROPE DEMERARA (1:1)', 2000, 'ml', [['ACUCAR DEMERARA', 1000], ['AGUA FILTRADA', 1000]]);
  criarProducaoInternaOlivio('XAROPE FALERNUM', 1000, 'ml', [['XAROPE DE ACUCAR (SIMPLES)', 700], ['LIMAO TAHITI', 100], ['GENGIBRE', 50], ['AMENDOA', 30]]);
  criarProducaoInternaOlivio('XAROPE GRENADINE', 1000, 'ml', [['SUCO DE ROMA (GRANADINA)', 500], ['ACUCAR REFINADO', 500]]);
  criarProducaoInternaOlivio('XAROPE ORGEAT (AMENDOA)', 1000, 'ml', [['LEITE DE AMENDOA', 500], ['ACUCAR REFINADO', 400], ['AGUA DE FLOR DE LARANJEIRA 250ML', 20]]);
  // ---------- Fichas tecnicas (filtro: viaveis pra bar de evento) ----------
  const criarReceita = (nome, categoria, modo_preparo, copo, guarnicao, itens) => {
    if (query('SELECT id FROM receitas WHERE nome = ?', [nome])[0]) return;
    const receitaId = runInsert(`INSERT INTO receitas
      (nome, categoria, modo_preparo, copo, guarnicao, preco_venda, ativo, utensilios, tempo_preparo, rendimento, vendas_periodo, markup_alvo)
      VALUES (?, ?, ?, ?, ?, 0, 1, '', '', '', 0, 0)`,
      [nome, categoria, modo_preparo, copo, guarnicao]);
    for (const [nomeInsumo, quantidade] of itens) {
      const insumoId = idPorNome(nomeInsumo);
      if (!insumoId) continue;
      run('INSERT INTO receita_itens (receita_id, insumo_id, quantidade) VALUES (?, ?, ?)', [receitaId, insumoId, quantidade]);
    }
  };

  criarReceita('Amaretto Sour', 'Core Call Drinks', 'Dry shake/Shake with ice/Fine strain/Egg coupe/Passion Shrub/Cumaru', '', '', [['LICOR AMARETTO DISARONNO 700ML', 30], ['BOURBON JIM BEAM WHITE 1L', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['CLARA DE OVO PASTEURIZADA', 22.5], ['SHRUB DE MARACUJA', 1]]);
  criarReceita('American Camping', 'Core Call Drinks', 'Stir/Old-fashioned w/ large ice/Mashmallow foam | 1. Marshmallow foam: | i. 200ml Clara de ovo | ii. 200g Áçucar | iii.1 Suco lemon | iv. 15ml Extrato de baunilha | v. Pitade de sal | vi. 2 hr | 50°C', '', '', [['ABSOLUT 1L', 30], ['VODKA ABSOLUT VANILIA 1L', 15], ['LICOR KAHLUA CAFE 750ML', 45]]);
  criarReceita('Aperol Spritz', 'Core Call Drinks', 'Build in white wine glass filled with cracked ice/Stir gently to  | combine/Orange half-wheel garnish', '', '', [['APEROL 750 ML', 60], ['AGUA COM GAS 1,5L', 60], ['ESPUMANTE BRUT 750ML', 60]]);
  criarReceita('Banzeiro', 'Cachaça', 'Shake/Fine strain/Old-Fashioned w/ large ice/Float wine/Ginger foam | 1. Espuma de gengibre: | i. 225 ml Citrus | ii. 100 ml Concentrado de gengibre | iii. 200 ml Xarope de áçucar | iv. 250ml Suco lime | v. 125 ml Clara de ovo', '', '', [['CACHACA AMBURANA 700ML', 50], ['XAROPE DE ACUCAR (SIMPLES)', 22.5], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['GARRAFÃO VINHO TINTO', 10], ['GENGIBRE', 1]]);
  criarReceita('Bee’s Knees', 'Core Call Drinks', 'Shake/Fine strain/Old-fashioned w/ large ice/Zest lemon | 1. Xarope de mel: | i. 500 g Mel | ii. 500 g Água filtrada | iii. 5 bags Twinings Camomila e Baunilha | iv. Zest de 1 lemon | v. 2 H | 55°C', '', '', [['DRACO LONDON DRY', 45], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['XAROPE DE MEL (1:1)', 22.5]]);
  criarReceita('Bloody Mary (à la minute if you really have to)', 'Core Call Drinks', 'Roll between tins with ice until  | chilled/Strain/Collins/Ice/Carrot/Lemon  | wedge/Rosemary | 1. Bloody mix: | a. 300 ml Molho inglês | b. 200 ml Molho de soja | c. 30 ml Chipotle Defumada | d. 10 ml Tabasco | e. 90 ml Mel | f. 1 tsp Ajinomoto | g. 1 tsp Sal de aipo | h. 60 ml Tequila defumada', '', '', [['ABSOLUT 1L', 60], ['SUCO DE TOMATE', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 30], ['SUCO DE TOMATE', 120]]);
  criarReceita('Boulevardier', 'Core Call Drinks', 'Short stir/Old-fashioned w/ large ice/Orange twist', '', '', [['BOURBON JIM BEAM WHITE 1L', 45], ['CAMPARI 998 ML', 30], ['VERMUTE ROSSO 1L', 30]]);
  criarReceita('Bramble', 'Core Call Drinks', 'Shake/Strain into prepped glass/Top with crushed ice/Lemon wheel/Float 15ml Crème de Mure | 1.Crème de Mure: | i.500 g Amora congelada | ii. 500 ml Saber Blueberry | iii. 2 H | 55°C', '', '', [['DRACO LONDON DRY', 45], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['XAROPE DE ACUCAR (SIMPLES)', 22.5], ['LICOR CREME DE MURE (AMORA) 700ML', 15]]);
  criarReceita('Campos de Morango', 'Gin Shaken', 'Shake/Fine Strain/Strawberry Coupe/Orange twist expressed/Strawberry slices |  1. Xarope de mel: |  i. 500 g Mel | ii. 500 g Água filtrada | iii. 5 bags Twinings Camomila e Baunilha | iv. Zest de 1 lemon | v. 2 H | 55°C', '', '', [['DRACO LONDON DRY', 30], ['ABSOLUT 1L', 15], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE MEL (1:1)', 7.5], ['XAROPE DE RUIBARBO', 7.5], ['CLARA DE OVO PASTEURIZADA', 15], ['NIB BITTER', 2]]);
  criarReceita('Cosmopolitan', 'Vodka Shaken', 'Shake/Fine strain/Coupe/Lemon twist', '', '', [['ABSOLUT 1L', 45], ['TRIPLE SEC COINTREAU 700ML', 25], ['SUCO DE CRANBERRY', 25], ['LIMAO TAHITI', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Cuba Libre', 'Highballs', 'Lime wedge', '', '', [['RUM BRANCO BACARDI 980ML', 45], ['LIMAO TAHITI', 10]]);
  criarReceita('Daiquiri', 'Core Call Drinks', 'Shake/Fine strain/Coupe/Lime wheel', '', '', [['RUM BRANCO BACARDI 980ML', 60], ['LIMAO TAHITI', 30], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Dark and Stormy', 'Core Call Drinks', 'Shake/strain/Long drink w/ ice cube/Lime wheel | 1. Espuma de gengibre: | i. 225 ml Citrus | ii. 100 ml Concentrado de gengibre | iii. 200 ml Xarope de áçucar | iv. 250ml Suco lime | v. 125 ml Clara de ovo', '', '', [['RUM SPICED CAPTAIN MORGAN 750ML', 30], ['RUM BRANCO BACARDI 980ML', 30], ['GENGIBRE', 15], ['LIMAO TAHITI', 15], ['GINGER ALE LATA 350ML', 1], ['ANGOSTURA BITTERS 200ML', 1], ['GENGIBRE', 1]]);
  criarReceita('Día de Los Muertos', 'Core Call Drinks', 'Build/Crushed ice/Grapefruit slice on top |  1.Soda de grapefruit: |  i. 180 ml Suco grapefruit  | ii. 60 ml Suco lime | iii. 30 ml Xarope de Agave | iv. 5 Dashes Solução Umami 20%  | 2. Solução Umamami 20%: |  i. 5 g  MSG | ii. 5 g Sal  |  iii. 40 g Água filtrada', '', '', [['TEQUILA PRATA JOSE CUERVO 750ML', 60], ['REFRIGERANTE DE GRAPEFRUIT (SODA)', 120]]);
  criarReceita('Dirty Gin Martini', 'Martini Gin', 'Stir/Strain/Coupe/Olives', '', '', [['DRACO LONDON DRY', 90], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 10], ['AGUA DE AZEITONA (SALMOURA)', 10], ['AZEITONA VERDE', 1]]);
  criarReceita('Dry Gin Martini', 'Martini Gin', '1. Stir/Strain/Coupe/Garnish with Olive or Lemon twist. | 2. Note: No bitters if it’s getting an olive.', '', '', [['DRACO LONDON DRY', 90], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 15]]);
  criarReceita('Espresso Martini', 'Vodka Shaken', 'Shake/Fine strain/Coupe/3 espresso beans | 1. Solução salina 20%: | i. 8 g Sal  | ii. 42 g Água filtrada', '', '', [['ABSOLUT 1L', 60], ['CAFE ESPRESSO (DOSE)', 30], ['LICOR KAHLUA CAFE 750ML', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['SOLUCAO SALINA', 2]]);
  criarReceita('Gold Rush', 'Bourbon Shaken', '', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE MEL (1:1)', 25]]);
  criarReceita('Hanky Panky', 'Gin Stirred', 'Stir/strain/coupe/orange twist', '', '', [['DRACO LONDON DRY', 45], ['VERMUTE ROSSO 1L', 45], ['FERNET BRANCA 1L', 10]]);
  criarReceita('Hemingway Daiquiri', 'Core Call Drinks', 'Shake/Fine strain/Coupe/Lime twist', '', '', [['RUM BRANCO BACARDI 980ML', 60], ['LIMAO TAHITI', 25], ['SUCO DE GRAPEFRUIT (ESPREMIDO)', 15], ['LICOR MARASCHINO LUXARDO 750ML', 15], ['XAROPE DE ACUCAR (SIMPLES)', 10], ['LIMAO TAHITI', 2]]);
  criarReceita('Henry Every Pirate', 'Dark Rum Shaken', 'Stirred/Barrel mug w/ ice/Lime twist expressed | 1. Pinneaple Sous-infused White Rum: | i. 700 ml Rum Branco | ii. 1 Abacaxi médio (sem cascas e miolo) | iii. 36 hrs | -20°C e coar chinoy', '', '', [['RUM SPICED CAPTAIN MORGAN 750ML', 30], ['RUM BRANCO BACARDI 980ML', 30], ['VERMUTE ROSSO 1L', 22.5], ['NIB BITTER', 3], ['LIMAO TAHITI', 1]]);
  criarReceita('Kiwi Spritz', 'Pisco Cocktails', 'Shake/Fine Strain/Collins glass with ice/Top with Prosecco/Lemon Twist/Dehidrated Kiwi', '', '', [['KIWI', 1], ['PISCO 750ML', 45], ['LICOR DE KIWI 700ML', 30], ['TRIPLE SEC COINTREAU 700ML', 15], ['LIMAO TAHITI', 15], ['BITTER DE LARANJA', 1], ['ANGOSTURA BITTERS 200ML', 2], ['PROSSECO AURORA', 1]]);
  criarReceita('Loi Krathong', 'White Rum Shaken', 'Shake/Fine strain/Boat cup/Flower | 1. Rice washed White Rum: | i. 700 ml Rum branco | ii. 250 g Arroz de jasmin | iii. 2 h | 30°C e coar filtro de papel', '', '', [['RUM BRANCO BACARDI 980ML', 60], ['RUM BRANCO BACARDI 980ML', 60], ['SUCO DE GRAPEFRUIT (ESPREMIDO)', 45], ['LIMAO TAHITI', 30], ['LICOR DRAMBUIE 700ML', 30], ['XAROPE DE MEL (2:1)', 15]]);
  criarReceita('Long Island Iced Tea', 'Core Call Drinks', 'Shake/Strain/Collins/Ice/Top with Coca Cola/Lemon wedge', '', '', [['ABSOLUT 1L', 22.5], ['RUM BRANCO BACARDI 980ML', 22.5], ['DRACO LONDON DRY', 22.5], ['TRIPLE SEC COINTREAU 700ML', 22.55], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['XAROPE DE ACUCAR (SIMPLES)', 22.5]]);
  criarReceita('Macunaima', 'Cachaça', 'Shake/Fine strain/Old-Fashioned w/ large ice/', '', '', [['CACHACA PRATA 965ML', 50], ['XAROPE DE ACUCAR (SIMPLES)', 22.5], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['FERNET BRANCA 1L', 10]]);
  criarReceita('Manhattan', 'Core Call Drinks', 'Stir/Strain/Brandied cherries on cocktail pick |', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['VERMUTE ROSSO 1L', 30], ['ANGOSTURA BITTERS 200ML', 3]]);
  criarReceita('Margarita', 'Core Call Drinks', 'Shake/Fine strain/Lime wedge | 1. MUST offer salt rim                                                                   a. ALWAYS half-rims of salt only. | 2. MUST offer coupe or rocks glass | a. ALWAYS add short straw if on the rocks. | 3. “Cadillac” Margarita substitutes Grand Marnier for  | Cointreau', '', '', [['TEQUILA PRATA JOSE CUERVO 750ML', 60], ['TRIPLE SEC COINTREAU 700ML', 30], ['LIMAO TAHITI', 30], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Mint Julep', 'Core Call Drinks', 'Crush mint in hand/Whip all ingredients with 3 pieces  | ice/Strain/Julep cup/Crushed ice/Mint sprigs', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['XAROPE DE ACUCAR (SIMPLES)', 10], ['HORTELA', 1], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Mojito', 'Core Call Drinks', 'Gentle Muddle/Whip shake with 2 ice cubes/Dump everything  | into chilled Collins glass/Top with crushed ice/.5 oz Club  | soda/Garnish with lime wheel and mint sprig/Straw', '', '', [['RUM BRANCO BACARDI 980ML', 60], ['LIMAO TAHITI', 30], ['XAROPE DE ACUCAR (SIMPLES)', 30], ['LIMAO TAHITI', 2]]);
  criarReceita('Moscow Mule', 'Core Call Drinks', 'Build/Mug w/ ice/Ginger foam | 1. Espuma de gengibre: | i. 225 ml Citrus | ii. 100 ml Concentrado de gengibre | iii. 200 ml Xarope de áçucar | iv. 250ml Suco lime | v. 125 ml Clara de ovo', '', '', [['ABSOLUT 1L', 50], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 30], ['XAROPE DE ACUCAR (SIMPLES)', 30], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Negroni', 'Core Call Drinks', 'Short stir/Rock/Orange twist | 1. Solução salina 20%: | i. 8 g Sal | ii. 42 g Água filtrada', '', '', [['DRACO LONDON DRY', 30], ['VERMUTE ROSSO 1L', 30], ['CAMPARI 998 ML', 30], ['SOLUCAO SALINA', 1]]);
  criarReceita('New York Sour', 'Rye Shaken', 'Dry shake everything but wine/Shake with ice/Fine  | train/Rocks glass/Large ice/Carefully float the wine over the top of the drink', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['XAROPE DE ACUCAR (SIMPLES)', 22.5], ['SUCO DE LARANJA (ESPREMIDA)', 15], ['GARRAFÃO VINHO BRANCO', 15]]);
  criarReceita('O Ritual', 'Bourbon Shaken', 'Muddle/Shake/Strain/Julep Cooper Glass/Crushed Ice/Mint sprigs | 1. Coconut Fat-washed Bourbon: | i. 750ml Woodford Reserve  | ii. 250g Óleo de coco | iii. 24 hrs and Coffee Filter Strain', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['XAROPE DE ACUCAR (SIMPLES)', 7.5], ['APEROL 750 ML', 7.5], ['HORTELA', 10], ['ANGOSTURA BITTERS 200ML', 3], ['BITTER DE LARANJA', 2]]);
  criarReceita('O Touro', 'Bourbon Shaken', 'Shake/Fine strain/Old-fashioned w/ large ice/Lemon Twist expressed & discarded/Bacon crispy on top', '', '', [['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['XAROPE DE ACUCAR (SIMPLES)', 22.5], ['ANGOSTURA BITTERS 200ML', 3]]);
  criarReceita('Old Fashioned', 'Core Call Drinks', 'Gentle Muddle/Short stir/Large rock/Orange twist/Amarena', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['XAROPE DE ACUCAR (SIMPLES)', 10], ['ANGOSTURA BITTERS 200ML', 3], ['ANGOSTURA BITTERS 200ML', 1], ['LARANJA', 1]]);
  criarReceita('Pac Man', 'Other', 'Shake/Strain/Pac Man Mug w/ ice/Crushed Ice/Mint sprigs/Tangerine slice', '', '', [['AMARO GENERICO 700ML', 45], ['XAROPE DE TANGERINA', 15], ['MAKGEOLLI (VINHO DE ARROZ) 750ML', 15], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['LICOR FRANGELICO (AVELA) 700ML', 3], ['MARACUJA POLPA', 10], ['ANGOSTURA BITTERS 200ML', 2], ['AGUA TONICA 1,5L', 1]]);
  criarReceita('Paper Plane', 'Bourbon Shaken', 'Shake/Fine strain/Coupe/No garnish', '', '', [['BOURBON JIM BEAM WHITE 1L', 22.5], ['APEROL 750 ML', 22.5], ['AMARO GENERICO 700ML', 22.5], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5]]);
  criarReceita('Penicillin', 'Scotch Shaken', 'Shake/Fine strain/Large rocks glass/Large ice/NO STRAW  | 1.  Xarope de mel:  | i. 500 g Mel | ii. 500 g Água filtrada | iii. 5 bags Twinings Camomila e Baunilha | iv.   Zest de 1 lemon | v. 2 H | 55°C | 2. Peated whisky: | i. Whisky Dewars 12 | ii. Defumar com mix carvalho', '', '', [['SCOTCH WHITE HORSE 1L', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 30], ['GENGIBRE', 15], ['XAROPE DE MEL (1:1)', 15], ['SINGLE MALT SCOTCH GENERICO 700ML', 1]]);
  criarReceita('Pisco Sour', 'Pisco Cocktails', 'Dry shake/Shake/Fine strain/Coupe/6 drops Aromatic bitter |', '', '', [['PISCO 750ML', 60], ['XAROPE DE ACUCAR (SIMPLES)', 22.5], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['LIMAO TAHITI', 15], ['CLARA DE OVO PASTEURIZADA', 22.5]]);
  criarReceita('Tokyo', 'Pisco Cocktails', '', '', '', [['SAKE 720ML', 30], ['NIB GIN (PERA)', 30], ['AGUA DE COCO 1L', 30], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['SUCO DE PIMENTAO AMARELO', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15]]);
  criarReceita('Tom Collins', 'Core Call Drinks', 'Shake/Strain/Collins/Ice/Club soda/Lemon wedge/Straw |', '', '', [['DRACO LONDON DRY', 45], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Universo Paralelo', 'Gin Shaken', 'Shake/Fine Strain/ Mushrrom Cup/Mirrá | 1. Xarope terpenado: | i.1000 ml Simple syrup | ii.5ml Terpenos | iii.10ml Propileno glicol', '', '', [['DRACO LONDON DRY', 45], ['LICOR DE DAMASCO (APRICOT BRANDY) 700ML', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE ACUCAR (SIMPLES)', 10], ['NIB BITTER', 2]]);
  criarReceita('White Lady', 'Gin Shaken', 'Dry shake/shake/fine strain/coupe/lemon twist expressed & discarded', '', '', [['DRACO LONDON DRY', 45], ['TRIPLE SEC COINTREAU 700ML', 22.5], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 22.5], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['CLARA DE OVO PASTEURIZADA', 22.5], ['BITTER DE LARANJA', 2]]);
  criarReceita('Wine Not A G&T', 'Gin Stirred', 'Build/collins glass with ice/float wine/lemon twist espressed', '', '', [['DRACO LONDON DRY', 45], ['AGUA TONICA 1,5L', 100], ['GARRAFÃO VINHO TINTO', 15]]);
  criarReceita('Winner Winner Chicken Dinner', 'Gin Stirred', 'Muddle/Shake/Fine Strain/Large Ice/Lemon twist expressed/Cherry Pick', '', '', [['BOURBON JIM BEAM WHITE 1L', 30], ['ALEXANDRION 7 BRANDY 1L', 30], ['LICOR ST GERMAIN (SABUGUEIRO) 700ML', 30], ['UVA NIAGARA', 5]]);
  criarReceita('Corpse Reviver No. 2', 'Gin Shaken', 'Shake/fine strain/absinthe-rinsed coupe/no garnish', '', '', [['DRACO LONDON DRY', 25], ['TRIPLE SEC COINTREAU 700ML', 25], ['APERITIVO VINHO FORTIFICADO GENERICO 750ML', 25], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25]]);
  criarReceita('London Maid', 'Gin Shaken', 'Shake/fine strain/dbl rocks/cucumber mint garnish', '', '', [['DRACO LONDON DRY', 60], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['LIMAO TAHITI', 25], ['HORTELA', 6], ['PEPINO', 2]]);
  criarReceita('Rolls Royce', 'Gin Stirred', 'Stir/strain/coupe/lemon twist', '', '', [['DRACO LONDON DRY', 60], ['VERMUTE ROSSO 1L', 20], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 20], ['LICOR BENEDICTINE DOM 700ML', 10]]);
  criarReceita('Tuxedo No. 2', 'Gin Stirred', 'Stir/strain/absinthe-rinsed coupe/lemon twist', '', '', [['DRACO LONDON DRY', 60], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 25], ['LICOR MARASCHINO LUXARDO 750ML', 10], ['ORANGE BITTERS 148ML', 2]]);
  criarReceita('Poet’s Dream (Vodka Version)', 'Vodka Stirred', 'Stir/strain/coupe/lemon twist', '', '', [['ABSOLUT 1L', 60], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 25], ['LICOR BENEDICTINE DOM 700ML', 1]]);
  criarReceita('Vesper Martini', 'Vodka Stirred', 'Stir/strain/coupe/lemon twist', '', '', [['DRACO LONDON DRY', 60], ['ABSOLUT 1L', 25], ['APERITIVO VINHO FORTIFICADO GENERICO 750ML', 15], ['ORANGE BITTERS 148ML', 1]]);
  criarReceita('Vodka Martini', 'Vodka Stirred', 'Stir/strain/coupe/olives or twist', '', '', [['ABSOLUT 1L', 90], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 15], ['NIB BITTER', 1]]);
  criarReceita('Apple Martini', 'Vodka Shaken', 'Shake/Fine strain/Coupe/Apple slices', '', '', [['ABSOLUT 1L', 45], ['POLPA ABACAXI', 45], ['XAROPE DE MEL (2:1)', 15], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE CANELA', 15]]);
  criarReceita('El Diablo', 'Tequila Shaken', 'Shake/strain/Collins glass with ice/top with ginger beer/lime  | wedge', '', '', [['TEQUILA PRATA JOSE CUERVO 750ML', 45], ['LIMAO TAHITI', 25], ['GENGIBRE', 10], ['LICOR CREME DE CASSIS 700ML', 10]]);
  criarReceita('Infante', 'Tequila Shaken', 'Shake/fine strain/rocks glass with pebble ice/mint', '', '', [['TEQUILA PRATA JOSE CUERVO 750ML', 60], ['LIMAO TAHITI', 30], ['XAROPE ORGEAT (AMENDOA)', 25], ['AGUA DE FLOR DE LARANJEIRA 250ML', 3]]);
  criarReceita('Tommy’s Margarita', 'Tequila Shaken', 'Shake/fine strain/rocks glass with ice/no garnish', '', '', [['TEQUILA PRATA JOSE CUERVO 750ML', 60], ['LIMAO TAHITI', 30], ['XAROPE DE AGAVE', 15]]);
  criarReceita('Augie March', 'Tequila Stirred', 'Stir/strain/rocks glass with large rock/cherry garnish on a pick', '', '', [['TEQUILA REPOSADO 750ML', 60], ['VERMUTE ROSSO 1L', 25], ['APERITIVO VINHO FORTIFICADO GENERICO 750ML', 15]]);
  criarReceita('Oaxacan Old Fashioned', 'Tequila Stirred', 'Short stir/strain/rocks glass with large rock/flamed orange twist', '', '', [['TEQUILA REPOSADO 750ML', 50], ['MEZCAL 750ML', 15], ['XAROPE DE AGAVE', 15], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Rosita', 'Tequila Stirred', 'Stir/strain/Coupe/orange twist', '', '', [['TEQUILA REPOSADO 750ML', 45], ['VERMUTE ROSSO 1L', 15], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 15], ['CAMPARI 998 ML', 15], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Kentucky Buck', 'Bourbon Shaken', 'Shake/Fine strain/Collins with ice/Top with ginger  | beer/Lemon wheel', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['ANGOSTURA BITTERS 200ML', 2], ['POLPA MORANGO', 1]]);
  criarReceita('Fancy Free', 'Bourbon Stirred', 'Short stir/Large rock/Orange twist', '', '', [['BOURBON JIM BEAM WHITE 1L', 65], ['CEREJA MARASCHINO (POTE)', 15], ['ANGOSTURA BITTERS 200ML', 2], ['ORANGE BITTERS 148ML', 1]]);
  criarReceita('Grandfather', 'Bourbon Stirred', 'Stir/Strain/Coupe', '', '', [['BOURBON JIM BEAM WHITE 1L', 30], ['ALEXANDRION 7 BRANDY 1L', 30], ['VERMUTE ROSSO 1L', 30], ['PEYCHAUD\'S BITTERS 148ML', 2], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Preakness Cocktail', 'Bourbon Stirred', 'Stir/Strain up/Coupe/Orange twist', '', '', [['BOURBON JIM BEAM WHITE 1L', 50], ['VERMUTE ROSSO 1L', 25], ['LICOR BENEDICTINE DOM 700ML', 10], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Ward Eight', 'Rye Shaken', 'Shake/Fine Strain/Coupe', '', '', [['RYE WHISKEY BULLEIT 1L', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['SUCO DE LARANJA (ESPREMIDA)', 15], ['XAROPE GRENADINE', 15]]);
  criarReceita('Whiskey Smash', 'Rye Shaken', 'Muddle/Shake/Fine Strain/Rocks Glass/Large ice/Mint  | garnish', '', '', [['RYE WHISKEY BULLEIT 1L', 60], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 10], ['LIMAO SICILIANO', 3], ['HORTELA', 8]]);
  criarReceita('American Trilogy', 'Rye Stirred', 'Build in a large rocks glass/Large ice cube/Stir briefly/Orange  | and Lemon twists', '', '', [['RYE WHISKEY BULLEIT 1L', 30], ['CALVADOS (BRANDY DE MACA) 700ML', 30], ['XAROPE DEMERARA (1:1)', 15], ['ORANGE BITTERS 148ML', 2]]);
  criarReceita('Old Pal', 'Rye Stirred', 'Stir/Strain/Coupe/No garnish |', '', '', [['RYE WHISKEY BULLEIT 1L', 60], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 25], ['CAMPARI 998 ML', 25]]);
  criarReceita('Red Hook', 'Rye Stirred', 'Stir/Strain/Coupe/No garnish', '', '', [['RYE WHISKEY BULLEIT 1L', 60], ['APERITIVO VINHO FORTIFICADO GENERICO 750ML', 15], ['LICOR MARASCHINO LUXARDO 750ML', 10]]);
  criarReceita('Castle to Castle', 'Irish Shaken', 'Shake/Fine strain/Collins glass with ice/Basil sprig garnish', '', '', [['WHISKEY IRLANDES JAMESON 1L', 45], ['POLPA ABACAXI', 45], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 0.25], ['XAROPE DE MEL (2:1)', 15]]);
  criarReceita('Irish Breakfast', 'Irish Shaken', 'Stir ingredients to dissolve marmalade/Shake/Fine  | strain/Coupe/Orange twist', '', '', [['WHISKEY IRLANDES JAMESON 1L', 50], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['TRIPLE SEC COINTREAU 700ML', 15], ['GELEIA DE LARANJA (MARMALADE)', 1]]);
  criarReceita('Wild Eyed Rose', 'Irish Shaken', 'Shake/Fine strain/Coupe/Lime wheel', '', '', [['WHISKEY IRLANDES JAMESON 1L', 60], ['XAROPE GRENADINE', 25], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['LIMAO TAHITI', 15]]);
  criarReceita('Blackthorn', 'Irish Stirred', 'Stir/Strain/Absinthe-rinsed large rocks glass/Large ice/Lemon  | expressed and discarded', '', '', [['WHISKEY IRLANDES JAMESON 1L', 70], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 15], ['XAROPE DEMERARA (1:1)', 10], ['ANGOSTURA BITTERS 200ML', 3]]);
  criarReceita('Improved Whiskey Cocktail', 'Irish Stirred', 'Build in large rocks glass/Large ice/Short stir/Lemon and  | Orange twists', '', '', [['WHISKEY IRLANDES JAMESON 1L', 60], ['XAROPE DEMERARA (1:1)', 10], ['LICOR MARASCHINO LUXARDO 750ML', 1], ['ORANGE BITTERS 148ML', 2], ['ABSINTHE 700ML', 2]]);
  criarReceita('Tipperary Cocktail', 'Irish Stirred', 'Stir/Strain/Coupe/Lemon twist', '', '', [['WHISKEY IRLANDES JAMESON 1L', 45], ['VERMUTE ROSSO 1L', 45], ['LICOR CHARTREUSE GREEN 700ML', 10], ['ANGOSTURA BITTERS 200ML', 1], ['ANGOSTURA BITTERS 200ML', 1], ['ABSINTHE 700ML', 1]]);
  criarReceita('Bobby Burns', 'Scotch Stirred', 'Stir/Strain/Coupe/Lemon twist', '', '', [['SCOTCH WHITE HORSE 1L', 60], ['APERITIVO VINHO FORTIFICADO GENERICO 750ML', 10], ['LICOR BENEDICTINE DOM 700ML', 15]]);
  criarReceita('Prince Edward', 'Scotch Stirred', 'Stir/Strain/Coupe/Orange twist |', '', '', [['SCOTCH WHITE HORSE 1L', 60], ['APERITIVO VINHO FORTIFICADO GENERICO 750ML', 25], ['LICOR DRAMBUIE 700ML', 15], ['ORANGE BITTERS 148ML', 2]]);
  criarReceita('Tattletale', 'Scotch Stirred', 'Built in large rocks glass/Large ice/Short stir/Orange and  | lemon twists', '', '', [['SINGLE MALT SCOTCH GENERICO 700ML', 35], ['SINGLE MALT SCOTCH GENERICO 700ML', 25], ['XAROPE DE MEL (2:1)', 15], ['ANGOSTURA BITTERS 200ML', 3]]);
  criarReceita('Mamie Taylor', 'Scotch Shaken', 'Shake/Strain/Collins glass/Ice/Top with Ginger Beer/Finish  | with 4 dashes Angostura bitters over the top/Lime  | wedge/Straw', '', '', [['SCOTCH WHITE HORSE 1L', 60], ['LIMAO TAHITI', 25], ['GENGIBRE', 15]]);
  criarReceita('Morning Glory Fizz', 'Scotch Shaken', 'Dry shake/Shake/Fine strain/Absinthe-rinsed fizz glass/1 oz.  | seltzer/Express lemon peel over the top', '', '', [['SCOTCH WHITE HORSE 1L', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['CLARA DE OVO PASTEURIZADA', 1]]);
  criarReceita('Chet Baker', 'Rum Stirred', 'Build in large rocks glass/Large rock/Orange twist', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 60], ['VERMUTE ROSSO 1L', 10], ['XAROPE DE MEL (2:1)', 5], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Dominicana', 'Rum Stirred', 'Stir/Strain/Nick & Nora glass/Hand-whipped cream  | float/Grated cinnamon | 1. For whipped cream, dry shake heavy cream in cocktail  | tin until desired texture is reached. Cream should look  | lightly textured and airy, and should keep a possum tail  | thickness when rolled between tins. | 2. This is usually a dessert cocktail, so be careful when  | recommending it.', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 45], ['LICOR KAHLUA CAFE 750ML', 45]]);
  criarReceita('El Presidente', 'Rum Stirred', 'Stir/Strain/Rocks glass/Large rock/Orange twist', '', '', [['RUM BRANCO BACARDI 980ML', 45], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 35], ['TRIPLE SEC COINTREAU 700ML', 1], ['XAROPE GRENADINE', 2.5]]);
  criarReceita('Airmail', 'White Rum Shaken', 'Shake/Fine strain/Coupe/Top with champagne/Lime wheel', '', '', [['RUM BRANCO BACARDI 980ML', 30], ['LIMAO TAHITI', 15], ['XAROPE DE MEL (2:1)', 15]]);
  criarReceita('Daisy de Santiago', 'White Rum Shaken', 'Whip shake with 3 ice cubes/Strain/Wine glass/Fill with  | cracked ice/Float barspoon of Yellow Chartreuse over the  | cocktail/Mint/Straw', '', '', [['RUM BRANCO BACARDI 980ML', 60], ['LIMAO TAHITI', 30], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Mary Pickford', 'White Rum Shaken', 'Shake/Fine strain/Coupe with one ice cube/Lime wheel', '', '', [['RUM BRANCO BACARDI 980ML', 45], ['POLPA ABACAXI', 30], ['LIMAO TAHITI', 10], ['LICOR MARASCHINO LUXARDO 750ML', 10], ['XAROPE GRENADINE', 10]]);
  criarReceita('Brooklynite', 'Dark Rum Shaken', 'Shake/Fine strain/Coupe/Lime wheel', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 60], ['LIMAO TAHITI', 25], ['XAROPE DE MEL (2:1)', 25], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Jungle Bird', 'Dark Rum Shaken', 'Shake/Fine strain/Rocks glass with ice/Pineapple frond |', '', '', [['RUM OVERPROOF 151 750ML', 30], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 30], ['POLPA ABACAXI', 30], ['CAMPARI 998 ML', 25], ['LIMAO TAHITI', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Royal Bermuda Yacht Club', 'Dark Rum Shaken', 'Shake/Fine strain/Coupe/Grated nutmeg | 1. Quick word on Falernum: Falernum is a spiced, limeforward alcoholic sugar syrup. The common version of  | Falernum is the store-bought John D. Taylor Falernum.  | This brand is tasty, but much in the same way that  | store-bought mayonnaise is tasty. That is to say that the  | store-bought stuff is fine, but once you start making it  | on your own, you will never turn back. Falernum takes a  | few days to make, but IT IS SO WORTH THE EFFORT.  | Look onl', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 60], ['LIMAO TAHITI', 30], ['TRIPLE SEC COINTREAU 700ML', 15], ['XAROPE FALERNUM', 15]]);
  criarReceita('Beachbum', 'TIKI', 'Shake/Strain/Double rocks glass/Cracked ice/Orange halfwheel with cherry skewer flag/Straw', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 30], ['RUM BRANCO BACARDI 980ML', 30], ['LICOR DE DAMASCO (APRICOT BRANDY) 700ML', 15], ['XAROPE ORGEAT (AMENDOA)', 15], ['POLPA ABACAXI', 30], ['LIMAO TAHITI', 25]]);
  criarReceita('Fog Cutter', 'TIKI', 'Shake/Strain/Collins/Ice/Straw/Float .5 oz. Moscatel  | Sherry/Lemon wheel', '', '', [['RUM BRANCO BACARDI 980ML', 45], ['ALEXANDRION 7 BRANDY 1L', 15], ['DRACO LONDON DRY', 15], ['SUCO DE LARANJA (ESPREMIDA)', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE ORGEAT (AMENDOA)', 25]]);
  criarReceita('Jet Pilot', 'TIKI', 'Swizzle/Tiki Mug/Fruit/Fire/Straws | 1. Yes, it’s almost the same thing as a Zombie. Go figure.', '', '', [['RUM OVERPROOF 151 750ML', 30], ['RUM OVERPROOF 151 750ML', 25], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 25], ['XAROPE FALERNUM', 15], ['XAROPE DE CANELA', 15], ['LIMAO TAHITI', 15], ['SUCO DE GRAPEFRUIT (ESPREMIDO)', 15], ['ABSINTHE 700ML', 1], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Painkiller', 'TIKI', 'Shake with 3 ice cubes/Strain/Snifter/Crushed ice/Grated  | nutmeg/Orange half-wheel/Cherry/Straws', '', '', [['RUM OVERPROOF 151 750ML', 30], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 15], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 15], ['XAROPE DE COCO MONIN 700ML', 25], ['POLPA ABACAXI', 45], ['SUCO DE LARANJA (ESPREMIDA)', 10]]);
  criarReceita('Scorpion', 'TIKI', 'Swizzle/Scorpion Bowl (or other mug)/Grated  | Nutmeg/Orange wheel/Lime wheel/Orchid/Straws', '', '', [['RUM OVERPROOF 151 750ML', 45], ['ALEXANDRION 7 BRANDY 1L', 25], ['XAROPE ORGEAT (AMENDOA)', 25], ['SUCO DE LARANJA (ESPREMIDA)', 25], ['LIMAO TAHITI', 25], ['PEYCHAUD\'S BITTERS 148ML', 3]]);
  criarReceita('Three Dots & A Dash', 'TIKI', 'Swizzle/Tiki mug/Crushed ice/Pineapple wedge/3  | cherries/Straws', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 45], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 15], ['XAROPE DE MEL (2:1)', 15], ['XAROPE FALERNUM', 15], ['SUCO DE LARANJA (ESPREMIDA)', 15], ['LIMAO TAHITI', 15], ['LICOR ALLSPICE DRAM 700ML', 10], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Zombie (1934)', 'TIKI', 'Swizzle/Tiki mug/Pebble ice/Flaming half-lime/Cinnamon  | stick/Whatever other cool stuff you want | 1. Be careful if your straws are plastic that you don’t add them into the mug when the lime is still on fire.', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 45], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 45], ['RUM OVERPROOF 151 750ML', 30], ['LIMAO TAHITI', 25], ['SUCO DE GRAPEFRUIT (ESPREMIDO)', 15], ['XAROPE FALERNUM', 15], ['XAROPE DE CANELA', 15], ['XAROPE GRENADINE', 15], ['ABSINTHE 700ML', 3], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Champs-elysees', 'Cognac Shaken', 'Shake/Fine strain/Coupe/No garnish', '', '', [['ALEXANDRION 7 BRANDY 1L', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['LICOR CHARTREUSE YELLOW 700ML', 15], ['XAROPE DE ACUCAR (SIMPLES)', 10], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Coffee Cocktail', 'Cognac Shaken', 'Dry shake/Shake/Fine strain/Small rocks glass/Nutmeg', '', '', [['VINHO DO PORTO 750ML', 45], ['ALEXANDRION 7 BRANDY 1L', 30], ['XAROPE DEMERARA (1:1)', 15], ['OVO INTEIRO', 1]]);
  criarReceita('Georgia Julep', 'Cognac Shaken', 'Crush mint in hand/Whip all ingredients with 3 pieces  | ice/Strain/Julep cup/Crushed ice/Mint sprigs', '', '', [['ALEXANDRION 7 BRANDY 1L', 70], ['XAROPE DE ACUCAR (SIMPLES)', 10], ['LICOR DE PESSEGO 700ML', 10], ['HORTELA', 1]]);
  criarReceita('De La Louisiane', 'Cognac Stirred', 'Short stir/Strain/Rocks glass/Large rock/Lemon twist', '', '', [['ALEXANDRION 7 BRANDY 1L', 30], ['RYE WHISKEY BULLEIT 1L', 30], ['LICOR BENEDICTINE DOM 700ML', 15], ['PEYCHAUD\'S BITTERS 148ML', 2], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Japanese Cocktail', 'Cognac Stirred', 'Stir/Strain/Nick & Nora glass/Lemon twist', '', '', [['ALEXANDRION 7 BRANDY 1L', 75], ['XAROPE ORGEAT (AMENDOA)', 15], ['ANGOSTURA BITTERS 200ML', 3]]);
  criarReceita('Vieux Carre', 'Cognac Stirred', 'Stir/Strain/Rocks glass/Large rock/Lemon twist', '', '', [['ALEXANDRION 7 BRANDY 1L', 30], ['RYE WHISKEY BULLEIT 1L', 30], ['APERITIVO VINHO FORTIFICADO GENERICO 750ML', 30], ['LICOR BENEDICTINE DOM 700ML', 1], ['ANGOSTURA BITTERS 200ML', 2], ['PEYCHAUD\'S BITTERS 148ML', 2]]);
  criarReceita('Frantic Atlantic', 'Pisco Cocktails', 'Whip shake/Strain/Large rocks glass/Crushed ice/Mint  | plouche/Straw', '', '', [['PISCO 750ML', 30], ['LICOR ST GERMAIN (SABUGUEIRO) 700ML', 30], ['SUCO DE GRAPEFRUIT (ESPREMIDO)', 30], ['LIMAO TAHITI', 15]]);
  criarReceita('Pisco Punch', 'Pisco Cocktails', 'Shake/Strain/Snifter with cracked ice/Orange  | twist/Mint/Pineapple wedge', '', '', [['PISCO 750ML', 60], ['LIMAO TAHITI', 25], ['XAROPE DE ABACAXI (GOMME)', 25], ['VINHO DO PORTO 750ML', 15], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('American Trilogy', 'Apple Brandy Stirred', 'Build in a large rocks glass/Large ice cube/Stir briefly/Orange  | and Lemon twists', '', '', [['RYE WHISKEY BULLEIT 1L', 30], ['CALVADOS (BRANDY DE MACA) 700ML', 30], ['XAROPE DEMERARA (1:1)', 15], ['ORANGE BITTERS 148ML', 2]]);
  criarReceita('Grandfather', 'Apple Brandy Stirred', 'Stir/Strain/Coupe', '', '', [['BOURBON JIM BEAM WHITE 1L', 30], ['ALEXANDRION 7 BRANDY 1L', 30], ['VERMUTE ROSSO 1L', 30], ['PEYCHAUD\'S BITTERS 148ML', 2], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Widow’s Kiss', 'Apple Brandy Stirred', 'Build in large rocks glass/Large ice/Short stir/No garnish |', '', '', [['CALVADOS (BRANDY DE MACA) 700ML', 60], ['LICOR CHARTREUSE YELLOW 700ML', 10], ['LICOR BENEDICTINE DOM 700ML', 10], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Applejack Rabbit', 'Apple Brandy Shaken', 'Shake/Fine strain/Coupe/No Garnish', '', '', [['CALVADOS (BRANDY DE MACA) 700ML', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['SUCO DE LARANJA (ESPREMIDA)', 25], ['XAROPE DE BORDO (MAPLE SYRUP) 250ML', 15]]);
  criarReceita('Jack Rose', 'Apple Brandy Shaken', 'Shake/Fine strain/Coupe/No Garnish', '', '', [['CALVADOS (BRANDY DE MACA) 700ML', 30], ['CALVADOS (BRANDY DE MACA) 700ML', 30], ['XAROPE GRENADINE', 25], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['LIMAO TAHITI', 15]]);
  criarReceita('Philadelphia Fish House Punch', 'Apple Brandy Shaken', 'Shake/Strain/Rock/Lemon wheel/Grated Cinnamon', '', '', [['CALVADOS (BRANDY DE MACA) 700ML', 30], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['LICOR DE PESSEGO 700ML', 10], ['XAROPE DEMERARA (1:1)', 10], ['GENGIBRE', 10], ['ORANGE BITTERS 148ML', 1]]);
  criarReceita('Adonis', 'Sherry Cocktails', 'Stir/Strain/Coupe/Orange twist', '', '', [['SHERRY FINO 750ML', 45], ['VERMUTE ROSSO 1L', 45], ['ORANGE BITTERS 148ML', 2]]);
  criarReceita('Bamboo', 'Sherry Cocktails', 'Stir/Strain/Coupe/Lemon twist', '', '', [['SHERRY FINO 750ML', 45], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 35], ['XAROPE DEMERARA (1:1)', 15], ['ANGOSTURA BITTERS 200ML', 1], ['ORANGE BITTERS 148ML', 1]]);
  criarReceita('Sherry Cobbler', 'Sherry Cocktails', 'Shake/Fine strain/Collins glass/Crushed ice/Float Pedro  | Ximenez sherry over the top/Lemon & orange  | wheel/Mint/Straw', '', '', [['SHERRY FINO 750ML', 90], ['XAROPE DE ABACAXI (GOMME)', 15]]);
  criarReceita('Airmail', 'Core Call Drinks', 'Shake/Fine strain/Coupe/Top with Champagne/Lime wheel', '', '', [['RUM BRANCO BACARDI 980ML', 30], ['LIMAO TAHITI', 15], ['XAROPE DE MEL (2:1)', 15]]);
  criarReceita('Americano Highball', 'Core Call Drinks', 'Build/Collins glass/Ice/Club soda/orange twist expressed and  | discarded/Orange half-wheel/Straw', '', '', [['VERMUTE ROSSO 1L', 45], ['CAMPARI 998 ML', 45]]);
  criarReceita('Arsenic & Old Lace', 'Core Call Drinks', 'Stir/Strain/Coupe/Absinthe-rinsed coupe/Orange twist', '', '', [['DRACO LONDON DRY', 60], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 25], ['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 10]]);
  criarReceita('Aviation', 'Core Call Drinks', 'Shake/Fine strain/Crème de Violette rinsed coupe/Brandied  | cherry in glass', '', '', [['DRACO LONDON DRY', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['LICOR MARASCHINO LUXARDO 750ML', 15], ['XAROPE DE ACUCAR (SIMPLES)', 10]]);
  criarReceita('Bellini', 'Core Call Drinks', '', '', '', [['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 12], ['PURE DE PESSEGO FABBRI', 30]]);
  criarReceita('Bijou', 'Core Call Drinks', 'Stir/Strain/Coupe/Lemon twist', '', '', [['DRACO LONDON DRY', 45], ['VERMUTE ROSSO 1L', 30], ['LICOR CHARTREUSE GREEN 700ML', 25], ['ORANGE BITTERS 148ML', 1]]);
  criarReceita('Black Russian', 'Core Call Drinks', 'Stir/Rock', '', '', [['ABSOLUT 1L', 60], ['LICOR KAHLUA CAFE 750ML', 25]]);
  criarReceita('Brandy Alexander', 'Core Call Drinks', 'Shake/Fine strain/Coupe/Nutmeg', '', '', [['ALEXANDRION 7 BRANDY 1L', 30], ['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 30], ['CREME DE LEITE FRESCO', 30]]);
  criarReceita('Brooklynite', 'Core Call Drinks', 'Shake/Fine strain/Coupe/Lime wheel', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 60], ['LIMAO TAHITI', 25], ['XAROPE DE MEL (2:1)', 25], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Caipirina', 'Core Call Drinks', 'Muddle/Fill tin with ice/Shake/Dump/Serve with straw', '', '', [['CACHACA PRATA 965ML', 60], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['LIMAO TAHITI', 1], ['LIMAO TAHITI', 3]]);
  criarReceita('Champagne Cocktail', 'Core Call Drinks', '', '', '', [['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Chartreuse Swizzle', 'Core Call Drinks', 'Build/Collins/Crushed ice/Swizzle/More crushed ice to just  | below the rim of the glass/Heavily dash a layer of Angostura  | bitters/Gently agitate the bitters with bar spoon to form a  | consistent layer/Top with fresh, dry crushed ice up, over the  | rim of the glass/Grated nutmeg/Mint sprig/Straw', '', '', [['LICOR CHARTREUSE GREEN 700ML', 35], ['XAROPE FALERNUM', 15], ['POLPA ABACAXI', 30], ['LIMAO TAHITI', 25]]);
  criarReceita('Chrysanthemum', 'Core Call Drinks', 'Short stir/Strain/Rock/Orange twist |', '', '', [['VERMUTE DRY MARTINI EXTRA DRY 750ML', 60], ['LICOR BENEDICTINE DOM 700ML', 25], ['ABSINTHE 700ML', 10]]);
  criarReceita('Clover Club', 'Core Call Drinks', 'Muddle/Dry shake/Shake with ice/Fine  | strain/Coupe/Skewered raspberries/Lemon twist expressed  | and discarded', '', '', [['DRACO LONDON DRY', 45], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 15], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['FRAMBOESA (POTE)', 5], ['CLARA DE OVO PASTEURIZADA', 1]]);
  criarReceita('Corn ‘n Oil', 'Core Call Drinks', 'Muddle/Hard shake with ice/Dump into double rocks  | glass/Serve as is', '', '', [['RUM OVERPROOF 151 750ML', 60], ['XAROPE FALERNUM', 10], ['LIMAO TAHITI', 3], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('East Side', 'Core Call Drinks', 'Whip shake with 3 ice cubes/Fine strain/Large rocks  | glass/Crushed ice/Mint sprig/Cucumber slice/Straw |', '', '', [['DRACO LONDON DRY', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['HORTELA', 1], ['PEPINO', 2]]);
  criarReceita('French 75', 'Core Call Drinks', 'Shake/Fine strain into coupe or champagne glass/Top with  | champagne/Spiraling lemon twist garnish', '', '', [['DRACO LONDON DRY', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Gimlet', 'Core Call Drinks', 'Shake/Fine strain/Lime wedge | 1. MUST offer coupe or rocks glass', '', '', [['DRACO LONDON DRY', 60], ['LIMAO TAHITI', 30], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['LIMAO TAHITI', 2]]);
  criarReceita('Gin Rickey', 'Core Call Drinks', 'Shake/Strain/Collins/Ice/1 oz. Club soda/Lime wedge/Straw', '', '', [['DRACO LONDON DRY', 45], ['LIMAO TAHITI', 25], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Godfather/Godmother', 'Core Call Drinks', 'Stir/Rock | 1. This is the Godfather recipe. For a Godmother,  | substitute vodka for the scotch.', '', '', [['SCOTCH WHITE HORSE 1L', 60], ['LICOR AMARETTO DISARONNO 700ML', 15]]);
  criarReceita('Grasshopper', 'Core Call Drinks', 'Shake/Fine strain/Coupe/Mint leaf', '', '', [['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 30], ['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 30], ['CREME DE LEITE FRESCO', 30], ['HORTELA', 8]]);
  criarReceita('Hot Toddy', 'Core Call Drinks', 'Heat cocktail with espresso wand/Pour into warm coffee  | cup/Garnish with cinnamon stick and clove-studded lemon  | wedge', '', '', [['BOURBON JIM BEAM WHITE 1L', 60], ['XAROPE DE MEL (2:1)', 15], ['LICOR BENEDICTINE DOM 700ML', 10], ['PEYCHAUD\'S BITTERS 148ML', 2]]);
  criarReceita('Irish Coffee', 'Core Call Drinks', 'Heat with espresso wand/Pour into hot cocktail cup/Top with  | hand-whipped heavy cream/Grated cinnamon | 1. For whipped cream, dry shake heavy cream in cocktail  | tin until desired texture is reached. Cream should look  | lightly textured and airy, and should keep a possum tail  | thickness when rolled between tins.', '', '', [['WHISKEY IRLANDES JAMESON 1L', 60], ['CAFE ESPRESSO (DOSE)', 30], ['XAROPE DEMERARA (1:1)', 25]]);
  criarReceita('Japanese Cocktai', 'Core Call Drinks', 'Stir/Strain/Nick & Nora/Lemon twist expressed and discarded', '', '', [['ALEXANDRION 7 BRANDY 1L', 75], ['XAROPE ORGEAT (AMENDOA)', 15], ['ANGOSTURA BITTERS 200ML', 3]]);
  criarReceita('Kir', 'Core Call Drinks', 'White wine glass full of cracked ice/Quick stir to  | combine/Lemon twist/Straw', '', '', [['LICOR CREME DE CASSIS 700ML', 15], ['GARRAFÃO VINHO BRANCO', 1]]);
  criarReceita('Kir Royale', 'Core Call Drinks', 'Coupe or Champagne flute/Garnish with a fresh  | raspberry/Lemon twist expressed and discarded', '', '', [['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 15], ['ESPUMANTE BRUT 750ML', 1]]);
  criarReceita('Last Word', 'Core Call Drinks', 'Shake/Fine strain/Nick & Nora', '', '', [['DRACO LONDON DRY', 25], ['LICOR MARASCHINO LUXARDO 750ML', 25], ['LICOR CHARTREUSE GREEN 700ML', 25], ['LIMAO TAHITI', 25]]);
  criarReceita('Mai Tai', 'Core Call Drinks', 'Shake with 3 ice cubes/Strain/Large rocks glass/Crushed  | ice/Orange half wheel fan and lime wheel/Straw | 1. MUST be house-made orgeat, or a very premium  | version like Tiki Adam Kolesar or Small Hands Foods.  | NEVER buy in bottled almond syrup, as it has the wrong  | viscosity.', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 30], ['RUM BRANCO BACARDI 980ML', 30], ['TRIPLE SEC COINTREAU 700ML', 15], ['LIMAO TAHITI', 30], ['XAROPE ORGEAT (AMENDOA)', 25], ['LIMAO TAHITI', 1]]);
  criarReceita('Martinez', 'Core Call Drinks', 'Stir/Strain/Coupe/Lemon twist', '', '', [['DRACO LONDON DRY', 60], ['VERMUTE ROSSO 1L', 30], ['LICOR MARASCHINO LUXARDO 750ML', 10], ['ANGOSTURA BITTERS 200ML', 2], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Mimosa', 'Core Call Drinks', 'Carefully poured into a flute | 1. Be careful because the bubbles will look scummy on the  | sides of the glass.  | 2. Spiraling orange peel', '', '', [['ESPUMANTE BRUT 750ML', 1], ['SUCO DE LARANJA (ESPREMIDA)', 1]]);
  criarReceita('Old Cuban', 'Core Call Drinks', 'Shake with 3 ice cubes/Fine strain/Coupe/Champagne/Mint  | leaf', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 60], ['XAROPE DEMERARA (1:1)', 15], ['LIMAO TAHITI', 15], ['ANGOSTURA BITTERS 200ML', 2], ['HORTELA', 6]]);
  criarReceita('Old Maid aka London Maid', 'Core Call Drinks', 'Whip shake with 3 ice cubes/Fine strain/Large rocks glass  | with cracked ice/Mint sprig/Cucumber slice/Stra    Same as “East Side” but on bigger ice. | Works with any white spirit', '', '', [['DRACO LONDON DRY', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['HORTELA', 1], ['PEPINO', 2]]);
  criarReceita('Pimm’s Cup', 'Core Call Drinks', 'Muddle/Shake with 3 ice cubes/Fine strain/Collins  | glass/ice/ginger ale/orange half wheel/mint/straw', '', '', [['LICOR PIMM\'S NO.1 700ML', 60], ['LIMAO TAHITI', 15], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['GENGIBRE', 15], ['POLPA MORANGO', 1]]);
  criarReceita('Piña Colada', 'Core Call Drinks', 'Whip shake with 3 ice cubes/Strain/Snifter/Crushed  | ice/Orange wheel cherry flag/Grated nutmeg', '', '', [['RUM BRANCO BACARDI 980ML', 30], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 30], ['POLPA ABACAXI', 45], ['XAROPE DE COCO MONIN 700ML', 30], ['CREME DE LEITE FRESCO', 10], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Pineapple Daiquiri', 'Core Call Drinks', 'Shake/Fine strain/Coupe/Stripe of Angostura bitters over the  | top', '', '', [['RUM BRANCO BACARDI 980ML', 30], ['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 30], ['POLPA ABACAXI', 30], ['LIMAO TAHITI', 25], ['XAROPE DE ACUCAR (SIMPLES)', 25]]);
  criarReceita('Queen’s Park Swizzle', 'Core Call Drinks', 'Fill Collins glass loosely with mint leaves/Add all  | ingredients/Press down with muddler to compact mint leaves  | into the bottom fifth of the glass/Taste and adjust as  | needed/Fill glass with ice/Swizzle/Add more ice until just  | below the rim of the glass/Heavily dash Angostura and  | Peychaud’s bitters to form a dense colored layer/Agitate the  | top layer gently with barspoon to make the bitters a consistent  | layer/Add more fresh, dry crushed ice up, over the rim of the  | glass/Add ', '', '', [['RUM ENVELHECIDO HAVANA CLUB 7 ANOS 750ML', 70], ['LIMAO TAHITI', 30], ['XAROPE DE ACUCAR (SIMPLES)', 25]]);
  criarReceita('Ramos Gin Fizz', 'Core Call Drinks', 'Dry shake/Shake with 3 ice cubes until they dissolve/Fine  | strain into a chilled Collins primed with 1.5 oz. chilled club  | soda/Pop into freezer if there’s time to solidify the foam/Add  | more club soda into cocktail tin to extract the remaining cream/Slowly add on top of cocktail to create attractive  | head/Straw', '', '', [['DRACO LONDON DRY', 60], ['CREME DE LEITE FRESCO', 30], ['XAROPE DE ACUCAR (SIMPLES)', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['LIMAO TAHITI', 15], ['AGUA DE FLOR DE LARANJEIRA 250ML', 0.5]]);
  criarReceita('Rob Roy', 'Core Call Drinks', 'Stir/Strain/Coupe/Brandied cherries on cocktail pick', '', '', [['SCOTCH WHITE HORSE 1L', 75], ['VERMUTE ROSSO 1L', 25], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Rome With A View', 'Core Call Drinks', 'Shake/Strain/Collins/Ice/Club soda/Lime wedge/Straw', '', '', [['VERMUTE DRY MARTINI EXTRA DRY 750ML', 30], ['CAMPARI 998 ML', 30], ['LIMAO TAHITI', 30], ['XAROPE DE ACUCAR (SIMPLES)', 25]]);
  criarReceita('Rusty Nail', 'Core Call Drinks', '', '', '', [['SCOTCH WHITE HORSE 1L', 60], ['LICOR DRAMBUIE 700ML', 15]]);
  criarReceita('Sazerac', 'Core Call Drinks', 'Stir/Strain/Lemon twist expressed and discarded', '', '', [['RYE WHISKEY BULLEIT 1L', 60], ['ALEXANDRION 7 BRANDY 1L', 15], ['XAROPE DEMERARA (1:1)', 15], ['PEYCHAUD\'S BITTERS 148ML', 3], ['ANGOSTURA BITTERS 200ML', 0.5], ['ABSINTHE 700ML', 1]]);
  criarReceita('Sidecar', 'Core Call Drinks', 'Shake/Fine strain/Sugar half-rimmed coupe', '', '', [['ALEXANDRION 7 BRANDY 1L', 60], ['LICOR COMBIER TRIPLE SEC 700ML', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Singapore Sling', 'Core Call Drinks', 'Whip shake with 3 ice cubes/Strain/Collins/1 oz. Club  | soda/Orange half-wheel/Cherry/Pineapple frond/Straw', '', '', [['DRACO LONDON DRY', 45], ['LICOR CHERRY HEERING 700ML', 15], ['LICOR BENEDICTINE DOM 700ML', 10], ['TRIPLE SEC COINTREAU 700ML', 10], ['POLPA ABACAXI', 45], ['LIMAO TAHITI', 15], ['XAROPE GRENADINE', 15], ['ANGOSTURA BITTERS 200ML', 1]]);
  criarReceita('Southside', 'Core Call Drinks', 'Whip shake with 3 ice cubes/Fine strain/Large rocks  | glass/Crushed ice/Mint sprig/Straw', '', '', [['DRACO LONDON DRY', 60], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE ACUCAR (SIMPLES)', 25], ['HORTELA', 1]]);
  criarReceita('Southside Fizz', 'Core Call Drinks', 'Whip shake with 3 ice cubes/Fine strain/Collins with small  | handful of mint leaves in bottom/Ice spear/Top with 1 oz. club  | soda/Lemon wheel and mint garnish/Straw', '', '', [['DRACO LONDON DRY', 45], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['HORTELA', 1]]);
  criarReceita('Stinger', 'Core Call Drinks', 'Whip shake/Strain/Small rocks glass/Crushed ice/Mint  | sprig/Straw', '', '', [['ALEXANDRION 7 BRANDY 1L', 60], ['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 12], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Ti’ Punch', 'Core Call Drinks', 'Muddle/Taste & adjust with syrup or lime juice/Fill glass ½  | cube and ½ pebble/Swizzle/Serve as is | 1. Lime heels are discs sliced deep from the side of the  | lime, mostly peel but with a thin layer of juice sacs still  | attached.', '', '', [['RUM BRANCO BACARDI 980ML', 60], ['XAROPE DE ACUCAR (SIMPLES)', 10]]);
  criarReceita('Vieux Carré', 'Core Call Drinks', 'Stir/Strain/Large rock/Lemon twist', '', '', [['RYE WHISKEY BULLEIT 1L', 30], ['ALEXANDRION 7 BRANDY 1L', 30], ['VERMUTE ROSSO 1L', 25], ['LICOR BENEDICTINE DOM 700ML', 10], ['PEYCHAUD\'S BITTERS 148ML', 3], ['ANGOSTURA BITTERS 200ML', 2]]);
  criarReceita('Bay Breeze', 'Highballs', 'Lime wedge | “Very cool & peaceful”', '', '', [['ABSOLUT 1L', 45]]);
  criarReceita('Cape Codder', 'Highballs', 'Lime wedge', '', '', [['ABSOLUT 1L', 45]]);
  criarReceita('Fuzzy Navel', 'Highballs', 'Orange half-wheel', '', '', [['LICOR DE PESSEGO 700ML', 45]]);
  criarReceita('Greyhound', 'Highballs', 'Grapefruit half-wheel | “Very Graceful” |', '', '', [['ABSOLUT 1L', 45]]);
  criarReceita('“Highball”', 'Highballs', 'Lime wedge', '', '', [['SCOTCH WHITE HORSE 1L', 45]]);
  criarReceita('Madras', 'Highballs', 'Lime wedge', '', '', [['ABSOLUT 1L', 45]]);
  criarReceita('Presbyterian', 'Highballs', 'Lime Wedge', '', '', [['SCOTCH WHITE HORSE 1L', 45]]);
  criarReceita('Screwdriver', 'Highballs', 'Orange half-wheel', '', '', [['ABSOLUT 1L', 45]]);
  criarReceita('Sea Breeze', 'Highballs', 'Lime wedge | “Very cool & gusty”', '', '', [['ABSOLUT 1L', 45]]);
  criarReceita('Seven & Seven', 'Highballs', 'Lemon & lime wedges', '', '', [['WHISKY CANADENSE 1L', 45]]);
  criarReceita('Shirley Temple', 'Highballs', 'Shake/strain/club soda/lemon wheel cherry flag |', '', '', [['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 30], ['LIMAO TAHITI', 30], ['XAROPE GRENADINE', 30]]);
  criarReceita('Gibson', 'Martini Gin', 'Stir/Strain/Coupe/Garnish with pickled onion', '', '', [['DRACO LONDON DRY', 75], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 30]]);
  criarReceita('Gin Martini', 'Martini Gin', '1. Stir/Strain/Coupe/Garnish with Olive or Lemon twist. | 2. Note: No bitters if it’s getting an olive.', '', '', [['DRACO LONDON DRY', 75], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 30], ['ORANGE BITTERS 148ML', 1]]);
  criarReceita('Vodka Martini', 'Martini Vodka', 'Stir/Strain/Coupe/Garnish with Olive or Lemon Twist', '', '', [['ABSOLUT 1L', 90], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 15]]);
  criarReceita('Dry Vodka Martini', 'Martini Vodka', 'Stir/Strain/Coupe/Garnish with Olive or Lemon Twist', '', '', [['ABSOLUT 1L', 90]]);
  criarReceita('Dirty Vodka Martini', 'Martini Vodka', 'Stir/Strain/Coupe/Olives', '', '', [['ABSOLUT 1L', 90]]);
  criarReceita('Apple Martini', 'Other', 'Shake/Fine strain/Coupe/Apple slices', '', '', [['ABSOLUT 1L', 45], ['POLPA ABACAXI', 45], ['XAROPE DE MEL (2:1)', 15], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE CANELA', 15]]);
  criarReceita('Chocolate Martini', 'Other', 'Shake/Fine strain/Coupe/Nutmeg', '', '', [['ABSOLUT 1L', 45], ['LICOR CREME DE FRUTA/ERVA GENERICO 700ML', 30], ['CREME DE LEITE FRESCO', 25]]);
  criarReceita('French Martini', 'Other', 'Shake/Fine strain/Coupe', '', '', [['ABSOLUT 1L', 50], ['POLPA ABACAXI', 30], ['LICOR CREME DE CASSIS 700ML', 15]]);
  criarReceita('Grapefruit Martini', 'Other', 'Shake/Fine strain/Coupe/Grapefruit twist', '', '', [['ABSOLUT 1L', 45], ['SUCO DE GRAPEFRUIT (ESPREMIDO)', 30], ['LIMAO TAHITI', 15], ['XAROPE DE MEL (2:1)', 15], ['OLEO-SACCHARUM DE LIMAO SICILIANO', 15]]);
  criarReceita('Lychee Martini', 'Other', 'Shake/Fine strain/Coupe', '', '', [['ABSOLUT 1L', 45], ['LICOR ST GERMAIN (SABUGUEIRO) 700ML', 15], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 25], ['XAROPE DE MEL (2:1)', 15], ['MARTINI BIANCO 1L', 1], ['ORANGE BITTERS 148ML', 0.5]]);
  criarReceita('B-52', 'Call Shots', 'Layer w/ bar spoon. Set on fire', '', '', [['LICOR KAHLUA CAFE 750ML', 1], ['LICOR BAILEY´S 750ML', 1], ['LICOR GRAND MARNIER 700ML', 1]]);
  criarReceita('Blow Job', 'Call Shots', 'Top w/ whipped cream |', '', '', [['LICOR KAHLUA CAFE 750ML', 1], ['LICOR BAILEY´S 750ML', 1]]);
  criarReceita('Irish Car Bomb', 'Call Shots', 'Drop into ½ glass of Guinness', '', '', [['LICOR BAILEY´S 750ML', 1], ['WHISKEY IRLANDES JAMESON 1L', 1]]);
  criarReceita('Kamikaze', 'Call Shots', '“Very Tragic Landing” |', '', '', [['ABSOLUT 1L', 1], ['TRIPLE SEC COINTREAU 700ML', 1], ['LIMAO TAHITI', 1]]);
  criarReceita('Lemon Drop', 'Call Shots', 'Shake/Fine strain/sugar half-rimmed Nick & Nora/Lemon  | twist expressed & discarded', '', '', [['ABSOLUT 1L', 30], ['SUCO DE LIMAO SICILIANO (ESPREMIDO)', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15]]);
  criarReceita('Melon Ball', 'Call Shots', '“MVP” |', '', '', [['LICOR MIDORI (MELAO) 700ML', 1], ['ABSOLUT 1L', 1], ['POLPA ABACAXI', 1]]);
  criarReceita('Mind Eraser', 'Call Shots', 'i. In that order. Serve with a straw. | ii. “Kills Vital Senses”', '', '', [['LICOR KAHLUA CAFE 750ML', 1], ['ABSOLUT 1L', 1], ['AGUA COM GAS 1,5L', 1]]);
  criarReceita('Sex on the Beach', 'Call Shots', '“MVP Rockstar” |', '', '', [['ABSOLUT 1L', 1], ['LICOR MIDORI (MELAO) 700ML', 1], ['POLPA ABACAXI', 1], ['LICOR DE FRAMBOESA 700ML', 1]]);
  criarReceita('A Princesa e o Plebeu', 'Call Shots', 'Stir/Coupe/Melon Ball/Lemon twist espressed', '', '', [['NIB GIN (PERA)', 45], ['LIMAO PG', 15], ['XAROPE DE ACUCAR (SIMPLES)', 15], ['SABORIZANTE MELAO', 5], ['TRIPLE SEC COINTREAU 700ML', 10]]);
  criarReceita('Cheque and te Matei', 'Call Shots', 'Build/Highball glass/Lime Gome/CO2', '', '', [['RUM SPICED CAPTAIN MORGAN 750ML', 30], ['CHA MATE 1 7 5', 100], ['GUARANA', 100], ['SOLUCAO ACIDO MALICO 6', 10], ['NIB BITTER', 1]]);
  criarReceita('Cinderela do Hype', 'Call Shots', 'Shaked/Coupe/Fini Beijo/Explosive Sugar', '', '', [['NIB GIN (PERA)', 45], ['LICOR DE FRAMBOESA 700ML', 15], ['LIMAO TAHITI', 15], ['CLARA DE OVO PASTEURIZADA', 15], ['VERMUTE DRY MARTINI EXTRA DRY 750ML', 7.5], ['PO DE MORANGO', 1]]);
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
  persistLocalOnly();
  scheduleCloudPush();
}
function persistLocalOnly() {
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
