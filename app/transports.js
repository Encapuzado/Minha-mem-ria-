// Meios de transporte para o ELM327. Todos têm: connect(), write(str), disconnect(), onData(str)

// 1) Simulador: responde como um ELM327 de verdade, assim o parser real é exercitado.
export class SimTransport {
  name = 'Simulador';
  onData = null;
  async connect() { this.t0 = performance.now(); }
  async disconnect() {}
  state() {
    const t = (performance.now() - this.t0) / 1000;
    const speed = Math.max(0, Math.round(55 + 45 * Math.sin(t / 9) + 6 * Math.sin(t / 2.3)));
    const rpm = Math.round(850 + speed * 32 + 120 * Math.sin(t * 1.7) + (speed > 80 ? 700 : 0));
    const coolant = Math.round(70 + Math.min(22, t / 4));
    return { speed, rpm, coolant, t };
  }
  async write(str) {
    const cmd = str.trim().toUpperCase().replace(/\s/g, '');
    const s = this.state();
    const hex = (n, w = 2) => Math.round(n).toString(16).toUpperCase().padStart(w, '0');
    let out = 'NO DATA';
    if (cmd.startsWith('AT')) out = cmd === 'ATRV' ? '12.7V' : cmd === 'ATZ' ? 'ELM327 v1.5' : 'OK';
    else if (cmd === '0100') out = '41 00 BE 3E B8 11';
    else if (cmd === '010C') out = '41 0C ' + hex(s.rpm * 4, 4).replace(/(..)(..)/, '$1 $2');
    else if (cmd === '010D') out = '41 0D ' + hex(s.speed);
    else if (cmd === '0105') out = '41 05 ' + hex(s.coolant + 40);
    else if (cmd === '0104') out = '41 04 ' + hex(20 + s.speed / 2);
    else if (cmd === '0111') out = '41 11 ' + hex(12 + s.speed / 3);
    else if (cmd === '010F') out = '41 0F ' + hex(32 + 40);
    else if (cmd === '012F') out = '41 2F ' + hex(62 * 2.55);
    else if (cmd === '0142') out = '41 42 ' + hex(14100 - 0 * s.t, 4).replace(/(..)(..)/, '$1 $2');
    else if (cmd === '0110') out = '41 10 ' + hex((4 + s.speed / 6) * 100, 4).replace(/(..)(..)/, '$1 $2');
    else if (cmd === '03') out = '43 01 01 33 00 00 00 00';
    else if (cmd === '04') out = '44';
    setTimeout(() => this.onData?.(out + '\r\r>'), 25);
  }
}

// 2) Web Bluetooth (somente adaptadores BLE; funciona no Chrome do Android)
export class BleTransport {
  name = 'Bluetooth BLE';
  onData = null;
  async connect() {
    const svcs = [0xfff0, 0xffe0, 0x18f0, '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
    this.dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: svcs });
    const server = await this.dev.gatt.connect();
    const services = await server.getPrimaryServices();
    for (const s of services) {
      for (const c of await s.getCharacteristics()) {
        if (c.properties.notify || c.properties.indicate) this.rx = c;
        if (c.properties.write || c.properties.writeWithoutResponse) this.tx = c;
      }
      if (this.rx && this.tx) break;
    }
    if (!this.rx || !this.tx) throw new Error('Esse adaptador não é BLE (provavelmente Bluetooth clássico)');
    const dec = new TextDecoder();
    await this.rx.startNotifications();
    this.rx.addEventListener('characteristicvaluechanged', e => this.onData?.(dec.decode(e.target.value)));
  }
  async disconnect() { try { this.dev?.gatt.disconnect(); } catch {} }
  async write(str) {
    const data = new TextEncoder().encode(str);
    for (let i = 0; i < data.length; i += 20) {
      const part = data.slice(i, i + 20);
      if (this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(part);
      else await this.tx.writeValue(part);
    }
  }
}

// 3) Bluetooth clássico (o ELM327 "mini" azul) via app Android com plugin
//    cordova-plugin-bluetooth-serial (Capacitor/Cordova). Expõe window.bluetoothSerial.
export class NativeTransport {
  name = 'Bluetooth (app)';
  onData = null;
  static available() { return typeof window.bluetoothSerial !== 'undefined'; }
  static list() {
    return new Promise((ok, err) => window.bluetoothSerial.list(ok, err));
  }
  constructor(address) { this.address = address; }
  connect() {
    const bs = window.bluetoothSerial;
    return new Promise((ok, err) => {
      bs.connect(this.address, () => {
        const dec = new TextDecoder();
        bs.subscribeRawData(buf => this.onData?.(dec.decode(buf)), () => {});
        ok();
      }, err);
    });
  }
  disconnect() { return new Promise(ok => window.bluetoothSerial.disconnect(ok, ok)); }
  write(str) { return new Promise((ok, err) => window.bluetoothSerial.write(str, ok, err)); }
}
