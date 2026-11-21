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
| Bluetooth (ELM327) | **ELM327 clássico** | app Android (`android/`) |

### App Android
O app (pasta `android/`, Capacitor 7, Android 6+) já inclui o plugin nativo `ElmBluetoothPlugin.java`
para o ELM327 clássico. Ele reconecta sozinho ao último adaptador quando a ignição é ligada.

Gerar o APK:
- **Na nuvem:** cada push roda o workflow *Gerar APK* (aba Actions do GitHub → artefato `agile-dash-apk`).
- **Local:** `npm ci && npm run apk` (precisa do Android SDK + JDK 21) → `android/app/build/outputs/apk/debug/app-debug.apk`.

Primeiro uso: pareie o "OBDII" no Bluetooth do Android (senha `1234` ou `0000`), abra o app,
Ajustes → **Bluetooth (ELM327)** → escolha o adaptador.

## Observações
- O consumo (km/l) é estimado pelo MAF assumindo gasolina; com etanol (flex) o valor real é diferente.
- PIDs que o carro não responde são desativados sozinhos após 3 falhas; a tensão cai para `ATRV`.
- Alerta de motor quente (padrão 105 °C) e bateria baixa (padrão 12 V).
