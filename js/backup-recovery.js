(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.BackupRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function temConteudoReal(dados) {
    if (!dados || typeof dados !== 'object') return false;

    const cal1 = dados.calendario1?.dadosOriginais;
    const cal2RioEs = dados.calendario2?.rio_es?.dadosOriginais;
    const cal2Leste = dados.calendario2?.leste?.dadosOriginais;
    const cal2Legado = dados.calendario2?.dadosOriginais;
    const legado = dados.dadosOriginais || dados.dadosPlanilha;

    return [cal1, cal2RioEs, cal2Leste, cal2Legado, legado]
      .some(item => item && typeof item === 'object' && Object.keys(item).length > 0);
  }

  function lerBackupLocal(storage) {
    const bruto = storage.getItem('escala_backup');
    if (!bruto) {
      return { valido: false, erro: 'Backup local não encontrado.' };
    }

    try {
      const dados = JSON.parse(bruto);
      const formatoReconhecido = Boolean(
        dados && (
          dados.versao === '3.0'
          || dados.calendario1
          || dados.calendario2
          || dados.dadosOriginais
          || dados.dadosPlanilha
        )
      );

      if (!formatoReconhecido || !temConteudoReal(dados)) {
        return { valido: false, erro: 'O backup local está vazio ou em formato inválido.' };
      }

      return {
        valido: true,
        dados,
        bruto,
        pendente: storage.getItem('escala_pendente_publicacao') === 'true',
        ultimoSalvamento: storage.getItem('escala_ultimo_salvamento')
      };
    } catch (_error) {
      return { valido: false, erro: 'O backup local está corrompido e não pôde ser lido.' };
    }
  }

  function nomeArquivoBackup(agora = new Date()) {
    const data = agora.toISOString().slice(0, 10);
    return `escala-backup-pendente-${data}.json`;
  }

  async function republicarBackupLocal(storage, publicar) {
    const backup = lerBackupLocal(storage);
    if (!backup.valido) throw new Error(backup.erro);

    const resultado = await publicar(backup.dados);
    storage.removeItem('escala_pendente_publicacao');
    return { backup, resultado };
  }

  return {
    lerBackupLocal,
    nomeArquivoBackup,
    republicarBackupLocal,
    temConteudoReal
  };
});
