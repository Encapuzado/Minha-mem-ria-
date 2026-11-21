import { ELM327 } from './obd.js';
import { SimTransport, BleTransport, NativeTransport, openApp } from './transports.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- Medidor circular (SVG, arco de 270°) ---------- */
function makeGauge(el, { label, unit, max, min = 0, redFrom = null, amberFrom = null, big = false, decimals = 0, lowBad = false }) {
  const R = 80, C = 2 * Math.PI * R, ARC = 0.75 * C;
  el.innerHTML = `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
    <g transform="rotate(135 100 100)">
      <circle class="track" cx="100" cy="100" r="${R}" stroke-dasharray="${ARC} ${C}"/>
      <circle class="val" cx="100" cy="100" r="${R}" stroke-dasharray="0 ${C}"/>
    </g>
    <text class="lbl" x="100" y="${big ? 66 : 70}" font-size="11">${label}</text>
    <text class="num" x="100" y="${big ? 124 : 118}" font-size="${big ? 62 : 46}">--</text>
    <text class="unit" x="100" y="${big ? 146 : 140}" font-size="12">${unit}</text></svg>`;
  const val = $('.val', el), num = $('.num', el);
  return v => {
    if (v == null || isNaN(v)) { num.textContent = '--'; val.setAttribute('stroke-dasharray', `0 ${C}`); return; }
    const f = Math.min(1, Math.max(0, (v - min) / (max - min)));
    val.setAttribute('stroke-dasharray', `${ARC * f} ${C}`);
    num.textContent = v.toFixed(decimals);
    let color = 'var(--blue)';
    if (lowBad) { if (amberFrom != null && v < amberFrom) color = 'var(--amber)'; if (redFrom != null && v < redFrom) color = 'var(--red)'; }
    else { if (amberFrom != null && v >= amberFrom) color = 'var(--amber)'; if (redFrom != null && v >= redFrom) color = 'var(--red)'; }
    val.style.stroke = color;
  };
}

const gauges = {
  speedBig: makeGauge($('#g-speed-big'), { label: 'Velocidade', unit: 'km/h', max: 200, big: true }),
  rpm: makeGauge($('#g-rpm'), { label: 'Rotação', unit: 'rpm', max: 7000, amberFrom: 5000, redFrom: 6000 }),
  speed: makeGauge($('#g-speed'), { label: 'Velocidade', unit: 'km/h', max: 200 }),
  coolant: makeGauge($('#g-coolant'), { label: 'Motor', unit: '°C', min: 40, max: 130, amberFrom: 100, redFrom: 108 }),
  fuel: makeGauge($('#g-fuel'), { label: 'Combustível', unit: '%', max: 100, amberFrom: 20, redFrom: 10, lowBad: true }),
};

/* ---------- Estado e render ---------- */
const data = {};
let lastSpeedTime = 0;
function set(k, v) {
  data[k] = v;
  if (k === 'maf' || k === 'speed') {
    // consumo estimado a partir do MAF (assume gasolina; com etanol o valor real é menor)
    if (data.maf && data.speed > 5) {
      const lph = (data.maf / 14) * 3600 / 740;
      data.kml = data.speed / lph;
    } else data.kml = null;
  }
  scheduleRender();
}
let raf = 0;
function scheduleRender() { if (!raf) raf = requestAnimationFrame(render); }
function fmt(v, d = 0) { return v == null || isNaN(v) ? '--' : v.toFixed(d); }
function render() {
  raf = 0;
  gauges.speedBig(data.speed); gauges.speed(data.speed); gauges.rpm(data.rpm);
  gauges.coolant(data.coolant); gauges.fuel(data.fuel);
  $('#rpmTxt').textContent = fmt(data.rpm);
  $('#rpmBar').style.width = Math.min(100, ((data.rpm || 0) / 7000) * 100) + '%';
  const o = { coolant: fmt(data.coolant), volt: fmt(data.volt, 1), fuel: fmt(data.fuel), kml: fmt(data.kml, 1) };
  for (const [k, v] of Object.entries(o)) { const e = $(`[data-v="${k}"]`); if (e) e.textContent = v; }
  const lim = settings.temp, vmin = settings.volt;
  $('#st-coolant').className = 'card stat ' + (data.coolant >= lim ? 'bad' : data.coolant >= lim - 8 ? 'warn' : '');
  $('#st-volt').className = 'card stat ' + (data.volt < vmin - 0.5 ? 'bad' : data.volt < vmin ? 'warn' : '');
  $('#st-fuel').className = 'card stat ' + (data.fuel < 10 ? 'bad' : data.fuel < 20 ? 'warn' : '');
  checkAlerts();
}

/* ---------- Alertas ---------- */
const settings = Object.assign({ temp: 105, volt: 12 }, store.get('settings', {}));
let alertUntil = 0, lastAlert = '';
function checkAlerts() {
  let msg = '';
  if (data.coolant >= settings.temp) msg = `⚠ Motor quente: ${Math.round(data.coolant)}°C`;
  else if (data.volt && data.volt < settings.volt && data.rpm > 1500) msg = `⚠ Bateria baixa: ${data.volt.toFixed(1)} V`;
  const el = $('#alert');
  if (msg) { el.textContent = msg; el.hidden = false; if (msg !== lastAlert && navigator.vibrate) navigator.vibrate(300); }
  else el.hidden = true;
  lastAlert = msg;
}
$('#setTemp').value = settings.temp; $('#setVolt').value = settings.volt;
$('#setTemp').onchange = e => { settings.temp = +e.target.value; store.set('settings', settings); };
$('#setVolt').onchange = e => { settings.volt = +e.target.value; store.set('settings', settings); };

/* ---------- Navegação ---------- */
function go(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.go === id));
}
$$('.nav').forEach(n => n.onclick = () => go(n.dataset.go));
$('#fs').onclick = () => document.documentElement.requestFullscreen?.().catch(() => {});

/* ---------- Relógio ---------- */
const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
tick(); setInterval(tick, 5000);

/* ---------- Conexão OBD ---------- */
let elm = null, transport = null, retryTimer = 0, wantDevice = null;
function setStatus(kind, txt) { $('#dot').className = kind; $('#statusTxt').textContent = txt; }
const msg = t => { $('#connMsg').textContent = t; };

async function disconnect(userAction = false) {
  clearTimeout(retryTimer);
  if (userAction) wantDevice = null;
  elm?.stop(); elm = null;
  const t = transport; transport = null;
  try { await t?.disconnect(); } catch {}
  setStatus('', 'Desconectado');
  $$('[data-conn]').forEach(b => b.classList.remove('sel'));
}

// Reconexão automática ao ELM327 (ex.: carro desligado, ignição religada)
function scheduleRetry(why) {
  if (!wantDevice) return;
  setStatus('wait', 'Aguardando carro…');
  msg(why + ' — tentando de novo em 10 s');
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => connectNative(wantDevice.address, wantDevice.name), 10000);
}

async function connect(t, label, key) {
  await disconnect();
  setStatus('wait', 'Conectando…'); msg('Conectando a ' + label + '…');
  try {
    transport = t;
    t.onClose = () => { if (transport === t) disconnect().then(() => scheduleRetry('Conexão perdida')); };
    await t.connect();
    elm = new ELM327(t);
    msg('Inicializando o adaptador (pode levar alguns segundos)…');
    await elm.init();
    setStatus('on', label); msg('Conectado: ' + label);
    $(`[data-conn="${key}"]`)?.classList.add('sel');
    go('home');
    let fails = 0;
    elm.start((k, v) => { fails = 0; set(k, v); }, e => {
      msg(String(e.message || e));
      if (++fails >= 5 && transport === t) disconnect().then(() => scheduleRetry('Carro parou de responder'));
    });
  } catch (e) {
    await disconnect();
    msg('Falha: ' + (e.message || e));
    scheduleRetry('Falha: ' + (e.message || e));
  }
}

function connectNative(address, name) {
  wantDevice = { address, name };
  store.set('lastDev', wantDevice);
  return connect(new NativeTransport(address), name || 'Bluetooth', 'native');
}

$$('[data-conn]').forEach(b => b.onclick = async () => {
  const k = b.dataset.conn;
  if (k === 'off') { store.set('lastDev', null); return disconnect(true); }
  wantDevice = null; clearTimeout(retryTimer);
  if (k === 'sim') return connect(new SimTransport(), 'Simulador', 'sim');
  if (k === 'ble') {
    if (!navigator.bluetooth) return msg('Este navegador não tem Web Bluetooth. Use o Chrome no Android.');
    return connect(new BleTransport(), 'Bluetooth BLE', 'ble');
  }
  if (k === 'native') {
    if (!NativeTransport.available()) return msg('O ELM327 mini azul usa Bluetooth clássico: só funciona no app Android instalado.');
    try {
      const list = await NativeTransport.list();
      const box = $('#devices'); box.innerHTML = '';
      list.forEach(d => {
        const bt = document.createElement('button'); bt.className = 'btn'; bt.textContent = d.name || d.address;
        bt.onclick = () => { box.innerHTML = ''; connectNative(d.address, d.name); };
        box.appendChild(bt);
      });
      msg(list.length ? 'Escolha o adaptador (normalmente “OBDII”).' : 'Nenhum dispositivo pareado. Pareie o OBDII nas configurações de Bluetooth do Android (senha 1234).');
    } catch (e) { msg('Erro: ' + (e.message || e)); }
  }
});

/* ---------- Abrir outros apps ---------- */
$$('[data-pkg]').forEach(b => b.onclick = () => openApp(b.dataset.pkg, b.dataset.web));

/* ---------- Diagnóstico ---------- */
$('#dtcRead').onclick = async () => {
  const box = $('#dtcList');
  if (!elm) { box.textContent = 'Conecte ao carro primeiro (Ajustes).'; return; }
  box.textContent = 'Lendo…';
  try {
    const codes = await elm.readDTC();
    box.innerHTML = codes.length
      ? codes.map(c => `<div class="code"><b>${c}</b>Pesquise o código para ver o significado</div>`).join('')
      : '✅ Nenhum código de falha armazenado.';
  } catch (e) { box.textContent = 'Erro: ' + e.message; }
};
$('#dtcClear').onclick = async () => {
  if (!elm) return;
  if (!confirm('Apagar os códigos de falha e desligar a luz da injeção?')) return;
  try { await elm.clearDTC(); $('#dtcList').textContent = 'Códigos apagados.'; } catch (e) { $('#dtcList').textContent = 'Erro: ' + e.message; }
};

/* ---------- Player de música ---------- */
const audio = $('#audio');
let tracks = [], cur = -1;
function renderTracks() {
  $('#tracks').innerHTML = '';
  tracks.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'trk' + (i === cur ? ' cur' : ''); d.textContent = t.name;
    d.onclick = () => play(i); $('#tracks').appendChild(d);
  });
}
function play(i) {
  if (!tracks.length) return;
  cur = (i + tracks.length) % tracks.length;
  audio.src = tracks[cur].url; audio.play().catch(() => {});
  const name = tracks[cur].name;
  $('#pTitle').textContent = $('#mTitle').textContent = name;
  $('#pSub').textContent = $('#mSub').textContent = `Faixa ${cur + 1} de ${tracks.length}`;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist: 'Agile Dash' });
  renderTracks();
}
const toggle = () => { if (!tracks.length) return go('music'); audio.paused ? audio.play() : audio.pause(); };
$('#files').onchange = e => {
  tracks = [...e.target.files].map(f => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
  renderTracks(); if (tracks.length) play(0);
};
$$('[data-m]').forEach(b => b.onclick = () => {
  const m = b.dataset.m; if (m === 'play') toggle(); else play(cur + (m === 'next' ? 1 : -1));
});
audio.onplay = audio.onpause = () => $$('[data-m="play"]').forEach(b => b.textContent = audio.paused ? '▶' : '⏸');
audio.onended = () => play(cur + 1);
audio.ontimeupdate = () => { if (audio.duration) $('#seek').value = (audio.currentTime / audio.duration) * 100; };
$('#seek').oninput = e => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration; };
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('nexttrack', () => play(cur + 1));
  navigator.mediaSession.setActionHandler('previoustrack', () => play(cur - 1));
}

/* ---------- Tela sempre ligada + PWA ---------- */
let wl; const keepAwake = async () => { try { wl = await navigator.wakeLock?.request('screen'); } catch {} };
document.addEventListener('click', keepAwake, { once: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

// Ao abrir: ?sim liga o simulador; no app, reconecta sozinho ao último ELM327 usado
const last = store.get('lastDev', null);
if (new URLSearchParams(location.search).has('sim')) connect(new SimTransport(), 'Simulador', 'sim');
else if (last?.address && NativeTransport.available()) connectNative(last.address, last.name);
render();
