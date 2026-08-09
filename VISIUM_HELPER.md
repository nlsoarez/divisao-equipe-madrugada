# Helper local do Visium

O backend da OCI nao esta na VPN, entao ele nao consegue acessar:

`http://201.55.234.76/Consultas_/ConsultaInterfaceNode`

Para testar incidentes de verdade sem extensao, instale este helper na maquina que esta conectada na VPN:

O instalador pede o dominio HTTPS publicado na OCI e o grava como
`CENTRAL_BACKEND_URL`. A URL antiga da Railway nao e mais usada.
Ele tambem pede o usuario e a senha Basic Auth para o helper conseguir registrar
o resultado no backend protegido.

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/nlsoarez/divisao-equipe-madrugada/main/instalar-visium-helper.ps1 -UseB | iex"
```

O instalador cria a pasta:

`%USERPROFILE%\visium-helper`

Depois disso, para usar novamente, abra:

`%USERPROFILE%\visium-helper\iniciar-visium-helper.bat`

Deixe a janela aberta enquanto clicar em **Testar incidentes** no site.

Fluxo:

1. O site procura `http://127.0.0.1:4789/health`.
2. Se o helper local estiver online, o teste roda pela VPN dessa maquina.
3. O helper consulta o Visium.
4. O helper salva o resultado no backend central da OCI.
5. Outros usuarios passam a ver os mesmos resultados.

Se o helper nao estiver rodando, o site cai no backend central. Nesse caso o resultado esperado e timeout/sem diagnostico, porque a OCI nao enxerga a rede interna.
