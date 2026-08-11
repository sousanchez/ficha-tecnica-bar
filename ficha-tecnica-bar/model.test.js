const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcIndicadores, computeMenuEngineering, cmvClass, calcCustoEventoPessoa, calcPrecoSugerido,
  calcCustoDraftItens, calcCustoUnitario, calcTotaisEvento, cmvIcon,
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

test('computeMenuEngineering: sem nenhuma receita com vendas_periodo -> null', () => {
  const receitas = [{ id: 1, nome: 'X', custo: 5, preco_venda: 10, vendas_periodo: 0 }];
  assert.equal(computeMenuEngineering(receitas), null);
});

test('computeMenuEngineering: classifica os 4 quadrantes contra a media do cardapio', () => {
  // media de vendas = (100+100+10+10)/4 = 55; media de margem = (8+2+8+2)/4 = 5
  const receitas = [
    { id: 1, nome: 'Estrela', custo: 2, preco_venda: 10, vendas_periodo: 100 },  // margem 8 (>=5), venda 100 (>=55) -> estrela
    { id: 2, nome: 'Cavalo', custo: 8, preco_venda: 10, vendas_periodo: 100 },   // margem 2 (<5), venda 100 (>=55) -> cavalo
    { id: 3, nome: 'Enigma', custo: 2, preco_venda: 10, vendas_periodo: 10 },    // margem 8 (>=5), venda 10 (<55) -> enigma
    { id: 4, nome: 'Abacaxi', custo: 8, preco_venda: 10, vendas_periodo: 10 },   // margem 2 (<5), venda 10 (<55) -> abacaxi
  ];
  const quad = computeMenuEngineering(receitas);
  assert.deepEqual(quad.estrela.map((r) => r.nome), ['Estrela']);
  assert.deepEqual(quad.cavalo.map((r) => r.nome), ['Cavalo']);
  assert.deepEqual(quad.enigma.map((r) => r.nome), ['Enigma']);
  assert.deepEqual(quad.abacaxi.map((r) => r.nome), ['Abacaxi']);
});

test('computeMenuEngineering: ignora receitas sem venda no periodo na classificacao', () => {
  const receitas = [
    { id: 1, nome: 'Com venda', custo: 2, preco_venda: 10, vendas_periodo: 5 },
    { id: 2, nome: 'Sem venda', custo: 2, preco_venda: 10, vendas_periodo: 0 },
  ];
  const quad = computeMenuEngineering(receitas);
  const todos = [...quad.estrela, ...quad.cavalo, ...quad.enigma, ...quad.abacaxi];
  assert.equal(todos.length, 1);
  assert.equal(todos[0].nome, 'Com venda');
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

test('calcPrecoSugerido: custo x markup normal', () => {
  assert.equal(calcPrecoSugerido(10, 3), 30);
});

test('calcPrecoSugerido: custo 0 -> 0', () => {
  assert.equal(calcPrecoSugerido(0, 5), 0);
});

test('calcPrecoSugerido: markup 0 -> 0', () => {
  assert.equal(calcPrecoSugerido(10, 0), 0);
});

test('calcPrecoSugerido: markup negativo -> sem trava, resultado negativo', () => {
  assert.equal(calcPrecoSugerido(10, -1), -10);
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
