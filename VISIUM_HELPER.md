# Helper local do Visium

O backend da Railway nao esta na VPN, entao ele nao consegue acessar:

`http://201.55.234.76/Consultas_/ConsultaInterfaceNode`

Para testar incidentes de verdade sem extensao, rode este helper na maquina que esta conectada na VPN:

```powershell
cd C:\Users\nlsoa\Documents\Codex\2026-07-02\nlsoarez-divisao-equipe-madrugada-https-github\work\divisao-equipe-madrugada\backend
npm run visium-helper
```

Deixe a janela aberta enquanto clicar em **Testar incidentes** no site.

Fluxo:

1. O site procura `http://127.0.0.1:4789/health`.
2. Se o helper local estiver online, o teste roda pela VPN dessa maquina.
3. O helper consulta o Visium.
4. O helper salva o resultado no backend central da Railway.
5. Outros usuarios passam a ver os mesmos resultados.

Se o helper nao estiver rodando, o site cai no backend central. Nesse caso o resultado esperado e timeout/sem diagnostico, porque a Railway nao enxerga a rede interna.
