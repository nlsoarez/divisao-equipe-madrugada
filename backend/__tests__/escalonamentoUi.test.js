'use strict';

const fs = require('fs');
const path = require('path');

describe('remoção isolada do escalonamento', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

  it('remove os pontos de entrada visuais do escalonamento', () => {
    expect(html).not.toContain('id="btnUploadEscalonamentoAdmin"');
    expect(html).not.toContain('id="escalonamentoPanelResidencial"');
    expect(html).not.toContain('id="escalonamentoSection"');
    expect(html).not.toContain('id="fileInputEscalonamento"');
  });

  it('preserva os recursos vizinhos do portal', () => {
    expect(html).toContain('id="tabResidencial"');
    expect(html).toContain('id="tabRioEs"');
    expect(html).toContain('id="tabLeste"');
    expect(html).toContain('lideranca-upload-info');
    expect(html).toContain('id="tabAlocacaoHub"');
    expect(html).toContain('id="tabGerencia"');
  });
});
