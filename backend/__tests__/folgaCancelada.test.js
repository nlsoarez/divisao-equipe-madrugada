const FolgaCancelada = require('../../js/folga-cancelada');

describe('cancelamento de folga', () => {
  test.each(['FF', 'FS', 'Folga', 'FOLGA FIXA', 'Folga semanal', 'DSR'])(
    'reconhece %s como folga',
    motivo => expect(FolgaCancelada.ehMotivoFolga(motivo)).toBe(true)
  );

  test.each(['Atestado', 'Férias', 'Falta', 'Licença médica', '']) (
    'não permite cancelar %s como folga',
    motivo => expect(FolgaCancelada.ehMotivoFolga(motivo)).toBe(false)
  );

  test('move o profissional para trabalhando e registra a dívida', () => {
    const dia = {
      trabalhando: ['Fernanda', 'Gabriela'],
      ausentes: [{ nome: 'Igor', motivo: 'FF' }, { nome: 'Sandro', motivo: 'Atestado' }],
      numPessoas: 2
    };

    const resultado = FolgaCancelada.cancelarFolga(dia, 'Igor', '2026-11-11T12:00:00.000Z');

    expect(resultado.ok).toBe(true);
    expect(dia.trabalhando).toEqual(['Fernanda', 'Gabriela', 'Igor']);
    expect(dia.ausentes).toEqual([{ nome: 'Sandro', motivo: 'Atestado' }]);
    expect(dia.numPessoas).toBe(3);
    expect(FolgaCancelada.listarPendentes(dia)).toEqual([
      expect.objectContaining({ nome: 'Igor', motivoOriginal: 'FF', status: 'pendente' })
    ]);
  });

  test('recusa ausência que não seja folga', () => {
    const dia = { trabalhando: [], ausentes: [{ nome: 'Sandro', motivo: 'Atestado' }] };
    expect(FolgaCancelada.cancelarFolga(dia, 'Sandro').ok).toBe(false);
    expect(dia.trabalhando).toEqual([]);
  });

  test('desfaz o cancelamento e restaura a folga original', () => {
    const dia = { trabalhando: ['Igor'], ausentes: [], numPessoas: 1 };
    dia.folgasCanceladas = [{ id: 'registro-1', nome: 'Igor', motivoOriginal: 'FS', status: 'pendente' }];

    expect(FolgaCancelada.desfazerCancelamento(dia, 'registro-1').ok).toBe(true);
    expect(dia.trabalhando).toEqual([]);
    expect(dia.ausentes).toEqual([{ nome: 'Igor', motivo: 'FS' }]);
    expect(FolgaCancelada.listarPendentes(dia)).toEqual([]);
  });
});
