const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcIndicadores, cmvClass, calcCustoEventoPessoa,
  calcCustoDraftItens, calcCustoUnitario, calcTotaisEvento, cmvIcon, fmtMoedaUnitario,
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
