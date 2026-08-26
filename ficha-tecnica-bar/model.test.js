const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcIndicadores, cmvClass, calcCustoEventoPessoa,
  calcCustoDraftItens, calcCustoUnitario, calcTotaisEvento, cmvIcon, fmtMoedaUnitario, ESTAGIOS_EVENTO,
  calcReceitaPorMes, fmtMesAno, calcCmvMedio, calcReceitasSemPreco, contarEventosSemData,
  calcRankingEventos,
} = require('./model.js');

test('calcIndicadores: caso normal', () => {
  const { cmv, markup, margem } = calcIndicadores(10, 40);
  assert.equal(cmv, 25);
  assert.equal(markup, 4);
  assert.equal(margem, 30);
});

test('calcIndicadores: preco de venda zero -> cmv nulo, markup 0 (custo>0), margem negativa', () => {
  const { cmv, markup, margem } = calcIndicadores(10, 0);
  assert.equal(cmv, null);
  assert.equal(markup, 0);
  assert.equal(margem, -10);
});

test('calcIndicadores: custo zero -> markup nulo, cmv zero', () => {
  const { cmv, markup, margem } = calcIndicadores(0, 20);
  assert.equal(cmv, 0);
  assert.equal(markup, null);
  assert.equal(margem, 20);
});

test('cmvClass: faixas boa/atencao/ruim', () => {
  assert.equal(cmvClass(20), 'good');
  assert.equal(cmvClass(30), 'warn');
  assert.equal(cmvClass(50), 'bad');
  assert.equal(cmvClass(null), '');
});

test('calcCustoEventoPessoa: lista vazia -> 0 (sem drink selecionado)', () => {
  assert.equal(calcCustoEventoPessoa([], 5), 0);
});

test('calcCustoEventoPessoa: 1 drink, 1 dose por pessoa -> custo do proprio drink', () => {
  assert.equal(calcCustoEventoPessoa([10], 1), 10);
});

test('calcCustoEventoPessoa: media simples entre varios drinks, escalada por doses/pessoa', () => {
  // media de [10, 20, 30] = 20; 20 x 3 doses/pessoa = 60
  assert.equal(calcCustoEventoPessoa([10, 20, 30], 3), 60);
});

test('calcCustoEventoPessoa: doses_por_pessoa = 0 -> 0 mesmo com drinks selecionados', () => {
  assert.equal(calcCustoEventoPessoa([10, 20], 0), 0);
});

test('calcCustoDraftItens: lista vazia -> 0', () => {
  assert.equal(calcCustoDraftItens([]), 0);
});

test('calcCustoDraftItens: soma quantidade x preco_unitario de cada item', () => {
  const itens = [
    { quantidade: 30, preco_unitario: 0.05 },
    { quantidade: 10, preco_unitario: 0.2 },
  ];
  // 30*0.05 + 10*0.2 = 1.5 + 2 = 3.5
  assert.equal(calcCustoDraftItens(itens), 3.5);
});

test('calcCustoUnitario: caso normal (mesma formula de recalcInsumoUnitario)', () => {
  // (100 / 1000) * 1.15 = 0.115 (com folga pra imprecisao de ponto flutuante)
  assert.ok(Math.abs(calcCustoUnitario(100, 1000, 1.15) - 0.115) < 1e-9);
});

test('calcCustoUnitario: tamanho ou fator zero/invalido caem pro padrao (1)', () => {
  assert.equal(calcCustoUnitario(100, 0, 1), 100);
  assert.equal(calcCustoUnitario(100, 1, 0), 100);
});

test('calcTotaisEvento: multiplica por convidados e calcula lucro', () => {
  const t = calcTotaisEvento(10, 25, 180);
  assert.equal(t.custoTotal, 1800);
  assert.equal(t.receitaTotal, 4500);
  assert.equal(t.lucroTotal, 2700);
});

test('calcTotaisEvento: zero convidados -> tudo zero', () => {
  const t = calcTotaisEvento(10, 25, 0);
  assert.equal(t.custoTotal, 0);
  assert.equal(t.receitaTotal, 0);
  assert.equal(t.lucroTotal, 0);
});

test('cmvIcon: um simbolo por faixa, alinhado com cmvClass', () => {
  assert.equal(cmvIcon(20), '✓ ');
  assert.equal(cmvIcon(30), '! ');
  assert.equal(cmvIcon(50), '✕ ');
  assert.equal(cmvIcon(null), '');
});

test('fmtMoedaUnitario: valor abaixo de 1 centavo arredonda pra cima pro minimo (R$0,01)', () => {
  assert.equal(fmtMoedaUnitario(0.0026), 'R$ 0,01');
  assert.equal(fmtMoedaUnitario(0.001), 'R$ 0,01');
});
test('fmtMoedaUnitario: zero continua R$0,00 (nao e "custo positivo pequeno")', () => {
  assert.equal(fmtMoedaUnitario(0), 'R$ 0,00');
});
test('fmtMoedaUnitario: valor >= 1 centavo mostra ate 4 casas quando precisa', () => {
  assert.equal(fmtMoedaUnitario(0.025), 'R$ 0,025');
  assert.equal(fmtMoedaUnitario(0.1), 'R$ 0,10');
  assert.equal(fmtMoedaUnitario(1.5), 'R$ 1,50');
});
test('ESTAGIOS_EVENTO: 2 estagios na ordem Confirmado/Realizado', () => {
  assert.deepEqual(
    ESTAGIOS_EVENTO.map((e) => e.valor),
    ['confirmado', 'realizado'],
  );
  assert.deepEqual(
    ESTAGIOS_EVENTO.map((e) => e.label),
    ['Confirmado', 'Realizado'],
  );
});

test('calcReceitaPorMes: lista vazia -> []', () => {
  assert.deepEqual(calcReceitaPorMes([]), []);
});
test('calcReceitaPorMes: um evento com data -> uma linha', () => {
  const eventos = [{ data: '2026-08-10', preco_pacote_pessoa: 50, convidados: 10 }];
  assert.deepEqual(calcReceitaPorMes(eventos), [{ mes: '2026-08', receita: 500 }]);
});
test('calcReceitaPorMes: dois eventos no mesmo mes -> soma na mesma linha', () => {
  const eventos = [
    { data: '2026-08-01', preco_pacote_pessoa: 50, convidados: 10 },
    { data: '2026-08-20', preco_pacote_pessoa: 30, convidados: 5 },
  ];
  assert.deepEqual(calcReceitaPorMes(eventos), [{ mes: '2026-08', receita: 650 }]);
});
test('calcReceitaPorMes: eventos em meses diferentes -> duas linhas ordenadas', () => {
  const eventos = [
    { data: '2026-09-01', preco_pacote_pessoa: 20, convidados: 10 },
    { data: '2026-08-01', preco_pacote_pessoa: 50, convidados: 10 },
  ];
  assert.deepEqual(calcReceitaPorMes(eventos), [
    { mes: '2026-08', receita: 500 },
    { mes: '2026-09', receita: 200 },
  ]);
});
test('calcReceitaPorMes: evento sem data -> ignorado', () => {
  const eventos = [
    { data: '', preco_pacote_pessoa: 50, convidados: 10 },
    { data: '2026-08-01', preco_pacote_pessoa: 30, convidados: 5 },
  ];
  assert.deepEqual(calcReceitaPorMes(eventos), [{ mes: '2026-08', receita: 150 }]);
});

test('fmtMesAno: converte YYYY-MM pro nome do mes em pt-BR', () => {
  assert.equal(fmtMesAno('2026-08'), 'Agosto/2026');
  assert.equal(fmtMesAno('2026-01'), 'Janeiro/2026');
  assert.equal(fmtMesAno('2026-12'), 'Dezembro/2026');
});

test('calcCmvMedio: lista vazia -> null', () => {
  assert.equal(calcCmvMedio([]), null);
});
test('calcCmvMedio: nenhuma receita com preco definido -> null (nao conta como 0)', () => {
  const receitas = [
    { custo: 10, preco_venda: 0 },
    { custo: 20, preco_venda: 0 },
  ];
  assert.equal(calcCmvMedio(receitas), null);
});
test('calcCmvMedio: mix de com/sem preco -> media so das precificadas', () => {
  const receitas = [
    { custo: 10, preco_venda: 40 }, // cmv 25
    { custo: 20, preco_venda: 0 }, // sem preco, fora da media
    { custo: 15, preco_venda: 30 }, // cmv 50
  ];
  // media de [25, 50] = 37.5
  assert.equal(calcCmvMedio(receitas), 37.5);
});
test('calcCmvMedio: todas com preco -> media simples', () => {
  const receitas = [
    { custo: 10, preco_venda: 40 }, // cmv 25
    { custo: 20, preco_venda: 40 }, // cmv 50
  ];
  assert.equal(calcCmvMedio(receitas), 37.5);
});

test('calcReceitasSemPreco: lista vazia -> 0', () => {
  assert.equal(calcReceitasSemPreco([]), 0);
});
test('calcReceitasSemPreco: todas sem preco -> N', () => {
  const receitas = [{ preco_venda: 0 }, { preco_venda: null }];
  assert.equal(calcReceitasSemPreco(receitas), 2);
});
test('calcReceitasSemPreco: mix -> conta so as sem preco', () => {
  const receitas = [{ preco_venda: 40 }, { preco_venda: 0 }, { preco_venda: 20 }];
  assert.equal(calcReceitasSemPreco(receitas), 1);
});
test('contarEventosSemData: lista vazia -> 0', () => {
  assert.equal(contarEventosSemData([]), 0);
});
test('contarEventosSemData: nenhum sem data -> 0', () => {
  const eventos = [{ data: '2026-08-01' }, { data: '2026-09-15' }];
  assert.equal(contarEventosSemData(eventos), 0);
});
test('contarEventosSemData: mix -> conta so os sem data', () => {
  const eventos = [{ data: '2026-08-01' }, { data: '' }, { data: null }, { data: '2026-09-15' }];
  assert.equal(contarEventosSemData(eventos), 2);
});
test('contarEventosSemData: todos sem data -> tamanho da lista', () => {
  const eventos = [{ data: '' }, { data: null }];
  assert.equal(contarEventosSemData(eventos), 2);
});

test('calcReceitasSemPreco: preco_venda negativo conta como sem preco', () => {
  const receitas = [{ preco_venda: -5 }, { preco_venda: 30 }];
  assert.equal(calcReceitasSemPreco(receitas), 1);
});

test('calcRankingEventos: lista vazia -> []', () => {
  assert.deepEqual(calcRankingEventos([]), []);
});
test('calcRankingEventos: um evento -> uma linha com receita/custo/lucro', () => {
  const eventos = [{ nome: 'Casamento A', custoPorPessoa: 10, preco_pacote_pessoa: 25, convidados: 100 }];
  assert.deepEqual(calcRankingEventos(eventos), [
    { nome: 'Casamento A', custoTotal: 1000, receitaTotal: 2500, lucroTotal: 1500 },
  ]);
});
test('calcRankingEventos: dois eventos -> ordena por lucro decrescente', () => {
  const eventos = [
    { nome: 'Evento menor lucro', custoPorPessoa: 10, preco_pacote_pessoa: 20, convidados: 100 }, // lucro 1000
    { nome: 'Evento maior lucro', custoPorPessoa: 10, preco_pacote_pessoa: 30, convidados: 100 }, // lucro 2000
  ];
  assert.deepEqual(
    calcRankingEventos(eventos).map((e) => e.nome),
    ['Evento maior lucro', 'Evento menor lucro'],
  );
});
test('calcRankingEventos: evento com custo maior que receita -> lucro negativo, sort continua correto', () => {
  const eventos = [
    { nome: 'Evento no prejuizo', custoPorPessoa: 30, preco_pacote_pessoa: 20, convidados: 100 }, // lucro -1000
    { nome: 'Evento no lucro', custoPorPessoa: 10, preco_pacote_pessoa: 20, convidados: 100 }, // lucro 1000
  ];
  const ranking = calcRankingEventos(eventos);
  assert.deepEqual(ranking.map((e) => e.nome), ['Evento no lucro', 'Evento no prejuizo']);
  assert.equal(ranking[1].lucroTotal, -1000);
});
test('calcRankingEventos: evento sem receitas vinculadas (custoPorPessoa 0) -> lucro = receita total', () => {
  const eventos = [{ nome: 'Sem drinks', custoPorPessoa: 0, preco_pacote_pessoa: 50, convidados: 20 }];
  const ranking = calcRankingEventos(eventos);
  assert.equal(ranking[0].custoTotal, 0);
  assert.equal(ranking[0].lucroTotal, 1000);
});
