(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiderancaEscala = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const LIDERES = Object.freeze({
    leste: 'Bruno',
    rio_es: 'Leandro',
    residencial: Object.freeze(['Kelly', 'Marley'])
  });

  function chaveData(ano, mes, dia) {
    return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  function dataDaChave(chave) {
    const partes = String(chave || '').split('-').map(Number);
    if (partes.length !== 3 || partes.some(Number.isNaN)) return null;
    return new Date(partes[0], partes[1] - 1, partes[2], 12, 0, 0);
  }

  function ehFimDeSemana(chaveOuData) {
    const data = chaveOuData instanceof Date ? chaveOuData : dataDaChave(chaveOuData);
    return !!data && (data.getDay() === 0 || data.getDay() === 6);
  }

  function normalizarRegistro(registro) {
    const origem = registro && typeof registro === 'object' ? registro : {};
    const folgas = Array.isArray(origem.folgas)
      ? [...new Set(origem.folgas.map(String).map(nome => nome.trim()).filter(Boolean))]
      : [];
    return {
      feriado: origem.feriado === true,
      folgas,
      liderGeral: String(origem.liderGeral || '').trim()
    };
  }

  function resolverDia(chave, registro) {
    const normalizado = normalizarRegistro(registro);
    const fimDeSemana = ehFimDeSemana(chave);
    const diaUnificado = fimDeSemana || normalizado.feriado;

    if (diaUnificado) {
      const lider = normalizado.liderGeral || 'A definir';
      return {
        tipo: normalizado.feriado ? 'feriado' : 'fim_de_semana',
        geral: lider,
        residencial: lider,
        rio_es: lider,
        leste: lider
      };
    }

    const estaDeFolga = nome => normalizado.folgas.includes(nome);
    const brunoFolga = estaDeFolga('Bruno');
    const leandroFolga = estaDeFolga('Leandro');
    let leste = 'Bruno';
    let rioEs = 'Leandro';

    if (brunoFolga && leandroFolga) {
      leste = estaDeFolga('Marley') ? 'A definir' : 'Marley';
      rioEs = leste;
    } else if (brunoFolga) {
      leste = 'Leandro';
      rioEs = 'Leandro';
    } else if (leandroFolga) {
      leste = 'Bruno';
      rioEs = 'Bruno';
    }

    const residenciais = LIDERES.residencial.filter(nome => !estaDeFolga(nome));
    const residencial = brunoFolga && leandroFolga
      ? (estaDeFolga('Kelly') ? 'A definir' : 'Kelly')
      : (residenciais.join(' / ') || 'A definir');

    return {
      tipo: 'dia_util',
      geral: '',
      residencial,
      rio_es: rioEs,
      leste
    };
  }

  function liderDaArea(chave, area, registro) {
    const resolvido = resolverDia(chave, registro);
    return resolvido[area] || 'A definir';
  }

  function nomeCanonico(nome) {
    const primeiroNome = String(nome || '').trim().split(/\s+/)[0]
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    return {
      BRUNO: 'Bruno',
      LEANDRO: 'Leandro',
      KELLY: 'Kelly',
      MARLEY: 'Marley'
    }[primeiroNome] || '';
  }

  function importarCalendario(dadosCalendario, ano, mes) {
    const dados = dadosCalendario && typeof dadosCalendario === 'object' ? dadosCalendario : {};
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const lideresEsperados = ['Bruno', 'Leandro', 'Kelly', 'Marley'];
    const nomesEncontrados = new Set();
    const dias = {};
    const erros = [];

    Object.values(dados).forEach(dia => {
      [...(dia?.trabalhando || []), ...(dia?.ausentes || []).map(item => item?.nome)].forEach(nome => {
        const canonico = nomeCanonico(nome);
        if (canonico) nomesEncontrados.add(canonico);
      });
    });

    const ausentesDaPlanilha = lideresEsperados.filter(nome => !nomesEncontrados.has(nome));
    if (ausentesDaPlanilha.length > 0) {
      erros.push(`Líder(es) não encontrado(s) na planilha: ${ausentesDaPlanilha.join(', ')}`);
    }

    for (let dia = 1; dia <= diasNoMes; dia++) {
      const chave = chaveData(ano, mes, dia);
      const registroDia = dados[dia];
      if (!registroDia) {
        erros.push(`Dia ${dia}: sem nenhum líder trabalhando`);
        continue;
      }

      const presentes = [...new Set((registroDia.trabalhando || []).map(nomeCanonico).filter(Boolean))];
      if (presentes.length === 0) {
        erros.push(`Dia ${dia}: sem nenhum líder trabalhando`);
        continue;
      }

      if (ehFimDeSemana(chave)) {
        if (presentes.length !== 1) {
          erros.push(`Dia ${dia}: fim de semana deve ter exatamente 1 líder, mas foram encontrados ${presentes.length}`);
          continue;
        }
        dias[chave] = { feriado: false, folgas: [], liderGeral: presentes[0] };
        continue;
      }

      // Um único líder trabalhando em dia útil caracteriza a escala unificada
      // de feriado. Nos demais dias, as ausências alimentam as substituições.
      if (presentes.length === 1) {
        dias[chave] = { feriado: true, folgas: [], liderGeral: presentes[0] };
      } else {
        dias[chave] = {
          feriado: false,
          folgas: lideresEsperados.filter(nome => !presentes.includes(nome)),
          liderGeral: ''
        };
      }
    }

    return { dias, erros, lideresEncontrados: [...nomesEncontrados] };
  }

  return {
    LIDERES,
    chaveData,
    dataDaChave,
    ehFimDeSemana,
    normalizarRegistro,
    resolverDia,
    liderDaArea,
    nomeCanonico,
    importarCalendario
  };
});
