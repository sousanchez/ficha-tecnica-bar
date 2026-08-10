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
  persist();
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
  const bytes = db.export();
  localStorage.setItem(LS_KEY, bytesToBase64(bytes));
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
    const bytes = new Uint8Array(reader.result);
    db = new SQL.Database(bytes);
    db.run(SCHEMA_SQL);
    migrateSchema();
    persist();
    renderAll();
    alert('Banco de dados importado com sucesso.');
  };
  reader.readAsArrayBuffer(file);
}
