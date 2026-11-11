(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FolgaCancelada = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MOTIVOS_FOLGA = new Set(['FF', 'FS', 'FOLGA', 'FOLGA FIXA', 'FOLGA SEMANAL', 'DSR']);

  function normalizarMotivo(motivo) {
    return String(motivo || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
  }

  function ehMotivoFolga(motivo) {
    return MOTIVOS_FOLGA.has(normalizarMotivo(motivo));
  }

  function criarId(nome) {
    const base = String(nome || 'pessoa').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `folga-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function listarPendentes(dadosDia) {
    if (!Array.isArray(dadosDia?.folgasCanceladas)) return [];
    return dadosDia.folgasCanceladas.filter(item => item && item.status === 'pendente');
  }

  function cancelarFolga(dadosDia, nome, canceladaEm) {
    if (!dadosDia || !Array.isArray(dadosDia.ausentes)) {
      return { ok: false, erro: 'Dados do dia inválidos.' };
    }

    const indice = dadosDia.ausentes.findIndex(
      item => item && item.nome === nome && ehMotivoFolga(item.motivo)
    );
    if (indice === -1) return { ok: false, erro: 'Folga não encontrada para este profissional.' };

    if (listarPendentes(dadosDia).some(item => item.nome === nome)) {
      return { ok: false, erro: 'Esta folga já está pendente de remarcação.' };
    }

    const ausencia = dadosDia.ausentes.splice(indice, 1)[0];
    if (!Array.isArray(dadosDia.trabalhando)) dadosDia.trabalhando = [];
    if (!dadosDia.trabalhando.includes(nome)) dadosDia.trabalhando.push(nome);
    dadosDia.numPessoas = dadosDia.trabalhando.length;

    if (!Array.isArray(dadosDia.folgasCanceladas)) dadosDia.folgasCanceladas = [];
    const registro = {
      id: criarId(nome),
      nome,
      motivoOriginal: ausencia.motivo,
      canceladaEm: canceladaEm || new Date().toISOString(),
      status: 'pendente'
    };
    dadosDia.folgasCanceladas.push(registro);
    return { ok: true, registro };
  }

  function desfazerCancelamento(dadosDia, registroId) {
    const registro = listarPendentes(dadosDia).find(item => item.id === registroId);
    if (!registro) return { ok: false, erro: 'Cancelamento de folga não encontrado.' };

    if (!Array.isArray(dadosDia.trabalhando)) dadosDia.trabalhando = [];
    dadosDia.trabalhando = dadosDia.trabalhando.filter(nome => nome !== registro.nome);
    if (!Array.isArray(dadosDia.ausentes)) dadosDia.ausentes = [];
    if (!dadosDia.ausentes.some(item => item && item.nome === registro.nome)) {
      dadosDia.ausentes.push({ nome: registro.nome, motivo: registro.motivoOriginal });
    }
    dadosDia.numPessoas = dadosDia.trabalhando.length;
    registro.status = 'desfeita';
    registro.desfeitaEm = new Date().toISOString();
    return { ok: true, registro };
  }

  return { normalizarMotivo, ehMotivoFolga, listarPendentes, cancelarFolga, desfazerCancelamento };
});
