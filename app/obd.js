// Protocolo ELM327 (independente do meio de transporte: simulador, BLE ou Bluetooth nativo)

export const PIDS = {
  rpm:      { cmd: '010C', parse: b => (b[0] * 256 + b[1]) / 4, fast: true },
  speed:    { cmd: '010D', parse: b => b[0], fast: true },
  coolant:  { cmd: '0105', parse: b => b[0] - 40 },
  load:     { cmd: '0104', parse: b => (b[0] * 100) / 255 },
  throttle: { cmd: '0111', parse: b => (b[0] * 100) / 255 },
  intake:   { cmd: '010F', parse: b => b[0] - 40 },
  fuel:     { cmd: '012F', parse: b => (b[0] * 100) / 255 },
  volt:     { cmd: '0142', parse: b => (b[0] * 256 + b[1]) / 1000 },
  maf:      { cmd: '0110', parse: b => (b[0] * 256 + b[1]) / 100 },
};

const hexBytes = s => (s.match(/.{2}/g) || []).map(h => parseInt(h, 16));

export class ELM327 {
  constructor(transport) {
    this.t = transport;
    this.buf = '';
    this.pending = null;
    this.queue = Promise.resolve();
    this.unsupported = {};
    this.misses = {};
    this.running = false;
    this.t.onData = chunk => this._onData(chunk);
  }

  _onData(chunk) {
    this.buf += chunk;
    if (this.buf.includes('>') && this.pending) {
      const txt = this.buf.replace(/>/g, '');
      this.buf = '';
      const p = this.pending;
      this.pending = null;
      p(txt);
    }
  }

  // Envia um comando e espera o prompt '>' (comandos são serializados)
  send(cmd, timeout = 4000) {
    const run = () => new Promise((resolve, reject) => {
      this.buf = '';
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('timeout: ' + cmd));
      }, timeout);
      this.pending = txt => { clearTimeout(timer); resolve(txt); };
      this.t.write(cmd + '\r').catch(e => { clearTimeout(timer); this.pending = null; reject(e); });
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  static lines(txt) {
    return txt.split(/[\r\n]+/).map(s => s.replace(/\s/g, '').toUpperCase()).filter(Boolean);
  }

  async init() {
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) {
      await this.send(c, c === 'ATZ' ? 6000 : 3000);
    }
    // 1ª consulta real: o adaptador procura o protocolo (pode demorar)
    const r = await this.send('0100', 12000);
    if (/UNABLETOCONNECT|BUSINIT|ERROR/.test(r.replace(/\s/g, '').toUpperCase())) {
      throw new Error('Ignição desligada ou carro não respondeu');
    }
  }

  // Retorna os bytes de dados do PID ou null
  async query(cmd) {
    const txt = await this.send(cmd);
    const want = '41' + cmd.slice(2);
    for (const l of ELM327.lines(txt)) {
      const i = l.indexOf(want);
      if (i >= 0) return hexBytes(l.slice(i + want.length));
    }
    return null;
  }

  async readVoltageAdapter() {
    const txt = await this.send('ATRV');
    const m = txt.match(/([0-9]+(\.[0-9]+)?)\s*V/i);
    return m ? parseFloat(m[1]) : null;
  }

  async readDTC() {
    const txt = await this.send('03', 8000);
    const codes = [];
    for (const l of ELM327.lines(txt)) {
      if (!l.startsWith('43')) continue;
      let h = l.slice(2);
      if (h.length % 4 === 2) h = h.slice(2); // CAN: 1º byte é a contagem
      for (let i = 0; i + 4 <= h.length; i += 4) {
        const w = h.slice(i, i + 4);
        if (w === '0000') continue;
        const b0 = parseInt(w.slice(0, 2), 16);
        codes.push('PCBU'[b0 >> 6] + ((b0 >> 4) & 3) + (b0 & 15).toString(16).toUpperCase() + w.slice(2));
      }
    }
    return codes;
  }

  async clearDTC() { return this.send('04', 8000); }

  // Laço de leitura: PIDs rápidos a cada ciclo, lentos em rodízio
  async start(onValue, onError) {
    this.running = true;
    const slow = Object.keys(PIDS).filter(k => !PIDS[k].fast);
    const fast = Object.keys(PIDS).filter(k => PIDS[k].fast);
    let n = 0;
    while (this.running) {
      try {
        const keys = [...fast, slow[n++ % slow.length]];
        for (const k of keys) {
          if (!this.running) break;
          if (this.unsupported[k]) continue;
          const bytes = await this.query(PIDS[k].cmd);
          if (bytes && bytes.length) {
            this.misses[k] = 0;
            onValue(k, PIDS[k].parse(bytes));
          } else if ((this.misses[k] = (this.misses[k] || 0) + 1) >= 3) {
            this.unsupported[k] = true;
          }
        }
        // Sem PID 0142? usa a tensão medida pelo próprio adaptador (ATRV)
        if (this.unsupported.volt && this.running && n % slow.length === 0) {
          const v = await this.readVoltageAdapter();
          if (v) onValue('volt', v);
        }
      } catch (e) {
        if (this.running) onError?.(e);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  stop() { this.running = false; }
}
