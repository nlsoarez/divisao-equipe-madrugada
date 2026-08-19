const fs = require('fs');
const path = require('path');
const vm = require('vm');

const modulo = { exports: {} };
vm.runInNewContext(
  fs.readFileSync(path.resolve(__dirname, '../../js/backup-recovery.js'), 'utf8'),
  { module: modulo, globalThis: {} }
);
const BackupRecovery = modulo.exports;

function criarStorage(inicial = {}) {
  const valores = new Map(Object.entries(inicial));
  return {
    getItem: jest.fn(chave => valores.has(chave) ? valores.get(chave) : null),
    setItem: jest.fn((chave, valor) => valores.set(chave, valor)),
    removeItem: jest.fn(chave => valores.delete(chave))
  };
}

const escalaValida = {
  escala_id: 'backup_local',
  versao: '3.0',
  calendarioAtivo: 'calendario1',
  calendario1: {
    dadosOriginais: {
      '2026-08-01': [{ nome: 'Pessoa 1', turno: 'Madrugada' }]
    }
  },
  calendario2: null
};

describe('recuperação do backup local da escala', () => {
  test('lê somente backup reconhecido e com conteúdo real', () => {
    const storage = criarStorage({
      escala_backup: JSON.stringify(escalaValida),
      escala_pendente_publicacao: 'true',
      escala_ultimo_salvamento: '2026-08-09T10:00:00.000Z'
    });

    expect(BackupRecovery.lerBackupLocal(storage)).toMatchObject({
      valido: true,
      dados: escalaValida,
      pendente: true,
      ultimoSalvamento: '2026-08-09T10:00:00.000Z'
    });
  });

  test.each([
    ['ausente', {}],
    ['corrompido', { escala_backup: '{invalido' }],
    ['vazio', { escala_backup: JSON.stringify({ versao: '3.0', calendario1: null }) }]
  ])('rejeita backup %s', (_nome, inicial) => {
    expect(BackupRecovery.lerBackupLocal(criarStorage(inicial)).valido).toBe(false);
  });

  test('republica exatamente o payload salvo e limpa a pendência só apó sucesso', async () => {
    const storage = criarStorage({
      escala_backup: JSON.stringify(escalaValida),
      escala_pendente_publicacao: 'true'
    });
    const publicar = jest.fn().mockResolvedValue({ sucesso: true });

    await BackupRecovery.republicarBackupLocal(storage, publicar);

    expect(publicar).toHaveBeenCalledWith(escalaValida);
    expect(storage.removeItem).toHaveBeenCalledWith('escala_pendente_publicacao');
  });

  test('mantém a pendência quando a publicação falha', async () => {
    const storage = criarStorage({
      escala_backup: JSON.stringify(escalaValida),
      escala_pendente_publicacao: 'true'
    });
    const publicar = jest.fn().mockRejectedValue(new Error('backend indisponível'));

    await expect(BackupRecovery.republicarBackupLocal(storage, publicar))
      .rejects.toThrow('backend indisponível');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test('gera nome de arquivo previsível para o resgate', () => {
    expect(BackupRecovery.nomeArquivoBackup(new Date('2026-08-09T12:00:00.000Z')))
      .toBe('escala-backup-pendente-2026-08-09.json');
  });
});
