// Sincronizacao em nuvem (Supabase) - opcional, o app funciona 100% offline
// sem isso. Quando ativado (PIN do bar), espelha o mesmo blob que ja vai pro
// localStorage (o banco SQLite inteiro, base64) num Postgres compartilhado.
// A protecao real fica no servidor: as funcoes RPC get_bar_state/save_bar_state
// conferem o PIN dentro do Postgres (RLS bloqueia acesso direto a tabela) -
// a anon key aqui embaixo e publica por design, nao e segredo.

const CLOUD_URL = 'https://myeoiynsvfnapbfxwxkm.supabase.co';
const CLOUD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15ZW9peW5zdmZuYXBiZnh3eGttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMzEyOTksImV4cCI6MjEwMjkwNzI5OX0.PeW2frF66--QUol4_dijscLCZ3W3-oGeTl3p4TIBBao';
const CLOUD_PIN_KEY = 'ficha_tecnica_bar_pin_v1';

let cloudPin = localStorage.getItem(CLOUD_PIN_KEY) || null;
let cloudSyncTimer = null;
let cloudStatus = cloudPin ? 'syncing' : 'off'; // 'off' | 'syncing' | 'ok' | 'error'

async function cloudRpc(fn, body) {
  const res = await fetch(`${CLOUD_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CLOUD_ANON_KEY, Authorization: `Bearer ${CLOUD_ANON_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${fn} falhou (${res.status}): ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const cloudPull = (pin) => cloudRpc('get_bar_state', { p_pin: pin });
const cloudPush = (pin, base64Blob) => cloudRpc('save_bar_state', { p_pin: pin, p_blob: base64Blob });

// Busca o estado da nuvem (que manda, sempre - modelo de banco unico
// compartilhado) e substitui o banco local por ele. Se a nuvem ainda estiver
// vazia (primeira vez que alguem conecta), este navegador vira a base inicial.
// Deixa o erro subir (PIN errado, sem rede) - quem chama decide o que fazer.
async function sincronizarComNuvem() {
  setCloudStatus('syncing');
  const remoteBase64 = await cloudPull(cloudPin);
  if (remoteBase64) {
    db = new SQL.Database(base64ToBytes(remoteBase64));
    db.run(SCHEMA_SQL);
    migrateSchema();
    persistLocalOnly();
    renderAll();
  } else {
    await cloudPush(cloudPin, bytesToBase64(db.export()));
  }
  setCloudStatus('ok');
}

// Roda uma vez no carregamento (so se ja tem PIN salvo neste navegador de uma
// conexao anterior) - falha silenciosa aqui, so atualiza o indicador; sem
// modal aberto pra mostrar erro nesse momento.
async function initCloudSync() {
  if (!cloudPin) { setCloudStatus('off'); return; }
  try {
    await sincronizarComNuvem();
  } catch (err) {
    console.error('Falha ao sincronizar com a nuvem', err);
    setCloudStatus('error');
  }
}

// Chamada pelo persist() a cada gravacao - manda pra nuvem com debounce (evita
// disparar uma chamada de rede a cada tecla/insercao durante uma edicao rapida
// ou um seed grande em lote).
function scheduleCloudPush() {
  if (!cloudPin) return;
  setCloudStatus('syncing');
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(async () => {
    try {
      await cloudPush(cloudPin, bytesToBase64(db.export()));
      setCloudStatus('ok');
    } catch (err) {
      console.error('Falha ao sincronizar com a nuvem', err);
      setCloudStatus('error');
    }
  }, 1500);
}

// Chamada pelo modal de conexao - PIN errado ou sem rede tem que aparecer na
// tela, entao NAO engole o erro (diferente do initCloudSync automatico).
async function conectarNuvem(pin) {
  const pinAnterior = cloudPin;
  cloudPin = pin;
  try {
    await sincronizarComNuvem();
    localStorage.setItem(CLOUD_PIN_KEY, pin);
  } catch (err) {
    cloudPin = pinAnterior; // nao salva PIN que nao funcionou
    setCloudStatus(pinAnterior ? 'ok' : 'off');
    throw err;
  }
}
function desconectarNuvem() {
  cloudPin = null;
  localStorage.removeItem(CLOUD_PIN_KEY);
  setCloudStatus('off');
}

function setCloudStatus(status) {
  cloudStatus = status;
  const el = document.getElementById('btn-cloud-status');
  if (!el) return;
  const map = {
    off: ['☁️ Conectar nuvem', ''],
    syncing: ['☁️ Sincronizando…', ''],
    ok: ['☁️ Sincronizado', 'ok'],
    error: ['⚠️ Erro na nuvem', 'error'],
  };
  const [label, cls] = map[status] || map.off;
  el.textContent = label;
  el.className = `btn secondary cloud-status cloud-status-${cls || 'off'}`;
}
