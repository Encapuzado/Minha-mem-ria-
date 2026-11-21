# Agile Dash

Central multimídia com dashboard OBD-II no estilo CarPlay, para um Android velho
no painel do Agile 2011 + adaptador ELM327 Bluetooth.

## Testar agora (simulador)
```bash
cd app && python3 -m http.server 8123
# abra http://localhost:8123/index.html?sim  (de preferência com o celular deitado)
```

## Telas
Início (velocidade, RPM, motor, bateria, combustível, consumo, mini player) · Painel (medidores grandes) ·
Música (arquivos locais + atalhos Spotify/YT Music) · Mapas (Waze/Google Maps) · Diagnóstico (ler/apagar DTC) ·
Ajustes (conexão e alertas de temperatura/bateria).

## Conectar ao carro de verdade
O ELM327 "mini" azul usa **Bluetooth clássico**, que navegadores NÃO acessam (Web Bluetooth só fala BLE).
Por isso existem 3 transportes em `app/transports.js`:

| Transporte | Funciona com | Onde |
|---|---|---|
| Simulador | nada (dados falsos) | qualquer navegador |
| BLE | adaptadores BLE | Chrome no Android |
| Bluetooth (app) | **ELM327 clássico** | app Android (Capacitor) |

### Empacotar como app Android (Capacitor)
```bash
npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/android cordova-plugin-bluetooth-serial
npx cap init AgileDash br.local.agiledash --web-dir app
npx cap add android && npx cap sync
npx cap open android   # Android Studio -> Run / gerar APK
```
Em `AndroidManifest.xml` confirme as permissões `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`.
Antes, pareie o adaptador nas configurações do Android (senha `1234` ou `0000`).

## Observações
- O consumo (km/l) é estimado pelo MAF assumindo gasolina; com etanol (flex) o valor real é diferente.
- PIDs que o carro não responde são desativados sozinhos após 3 falhas; a tensão cai para `ATRV`.
- Alerta de motor quente (padrão 105 °C) e bateria baixa (padrão 12 V).
