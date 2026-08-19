const storageHub = require('../storageHub');
const { processarMensagemHub, _internals: parserInternals } = require('../parserHub');

describe('Regras de exibição da alocação de HUB', () => {
  const madrugada = {
    messageId: 'madrugada-1',
    tipoAlocacao: 'MADRUGADA',
    dataRecebimento: '2026-08-12T22:57:05.000Z'
  };
  const diurnoPosterior = {
    messageId: 'diurno-1',
    tipoAlocacao: 'DIURNO',
    dataRecebimento: '2026-08-13T02:20:24.000Z'
  };

  test('mantém a madrugada até 04:59 de Brasília mesmo com diurno posterior', () => {
    const atual = storageHub._internals.selecionarAlocacaoAtual(
      [madrugada, diurnoPosterior],
      new Date('2026-08-13T07:59:00.000Z')
    );

    expect(atual.messageId).toBe('madrugada-1');
  });

  test('troca para o diurno às 05:00 de Brasília', () => {
    const atual = storageHub._internals.selecionarAlocacaoAtual(
      [madrugada, diurnoPosterior],
      new Date('2026-08-13T08:00:00.000Z')
    );

    expect(atual.messageId).toBe('diurno-1');
  });

  test('não mantém uma madrugada vencida quando não há diurno', () => {
    const atual = storageHub._internals.selecionarAlocacaoAtual(
      [madrugada],
      new Date('2026-08-13T08:00:00.000Z')
    );

    expect(atual).toBeNull();
  });
});

describe('Formatação das observações da madrugada', () => {
  test.each([
    ['vai direto para Paraná]', 'vai direto para Paraná'],
    ['[vai direto para Tijuca].', 'vai direto para Tijuca'],
    ['vai direto para Sulacap', 'vai direto para Sulacap']
  ])('limpa colchetes residuais de %s', (input, expected) => {
    expect(parserInternals.limparObservacao(input)).toBe(expected);
  });

  test('não grava o colchete órfão no técnico processado', () => {
    const resultado = processarMensagemHub({
      message_id: 'madrugada-parser-1',
      date: Date.parse('2026-08-12T22:57:05.000Z') / 1000,
      text: [
        'ALOCAÇÃO TÉCNICA HUBS/RJO MADRUGADA',
        '________________',
        'Celso: Paraná',
        '[Obs: vai direto para Paraná].',
        'Tel: 9214-2566'
      ].join('\n')
    });

    expect(resultado.dados.tecnicos[0].observacao).toBe('vai direto para Paraná');
    expect(resultado.dados.tecnicos[0].atividade).toBeNull();
  });
});
