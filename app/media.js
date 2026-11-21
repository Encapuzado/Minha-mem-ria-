// Música: junta duas fontes numa interface só
//  - "ext": o que está tocando no Android (Spotify, YT Music...) via plugin nativo Media — funciona offline
//  - "local": arquivos de áudio escolhidos no próprio celular
import { openApp } from './transports.js';

const plugin = () => window.Capacitor?.Plugins?.Media;
const isNative = () => !!(window.Capacitor?.isNativePlatform?.() && plugin());

const APP_NAMES = {
  'com.spotify.music': 'Spotify',
  'com.google.android.apps.youtube.music': 'YouTube Music',
  'deezer.android.app': 'Deezer',
};

export function initMedia({ $, $$, go }) {
  const audio = $('#audio');
  let tracks = [], cur = -1;
  let ext = { active: false }, extAt = 0, extArt = '';
  let source = isNative() ? 'ext' : 'local';

  /* ---------- Render ---------- */
  function setArt(url) {
    for (const el of [$('#art'), $('#art2')]) {
      el.style.backgroundImage = url ? `url("${url}")` : '';
      el.classList.toggle('has-img', !!url);
      el.textContent = url ? '' : '♪';
    }
  }

  function render() {
    let title, sub, playing, pos = 0, dur = 0, art = '';
    if (source === 'local') {
      title = cur >= 0 ? tracks[cur].name : 'Nenhuma música';
      sub = cur >= 0 ? `Arquivo local · ${cur + 1} de ${tracks.length}` : (isNative() ? 'Abra o Spotify e dê play' : 'Toque em “Adicionar músicas”');
      playing = !audio.paused;
      pos = audio.currentTime * 1000; dur = (audio.duration || 0) * 1000;
    } else if (ext.active && ext.title) {
      title = ext.title;
      sub = [ext.artist, APP_NAMES[ext.pkg]].filter(Boolean).join(' · ');
      playing = !!ext.playing;
      dur = ext.duration || 0;
      pos = (ext.position || 0) + (playing ? performance.now() - extAt : 0);
      art = extArt;
    } else {
      title = 'Nada tocando';
      sub = 'Toque ▶ ou abra o Spotify';
      playing = false;
    }
    $('#mTitle').textContent = $('#pTitle').textContent = title;
    $('#mSub').textContent = $('#pSub').textContent = sub;
    $$('[data-m="play"]').forEach(b => b.textContent = playing ? '⏸' : '▶');
    if (!seeking) $('#seek').value = dur ? Math.min(100, (pos / dur) * 100) : 0;
    setArt(source === 'local' ? '' : art);
  }
  let seeking = false;
  setInterval(() => { if (source === 'ext' && ext.playing) render(); }, 500);

  /* ---------- Fonte Android (Spotify etc.) ---------- */
  async function startExt() {
    const p = plugin();
    if (!p) return;
    const { value } = await p.hasAccess();
    $('#mediaAccess').hidden = value;
    if (!value) return;
    if (!startExt.listening) {
      startExt.listening = true;
      await p.addListener('media', e => {
        if ('art' in e) extArt = e.art;
        ext = e; extAt = performance.now();
        // Se o Spotify começou a tocar, pausa o MP3 local e mostra o Spotify
        if (e.playing) { if (!audio.paused) audio.pause(); source = 'ext'; }
        render();
      });
    }
    try { await p.start(); } catch {}
  }
  if (isNative()) {
    startExt();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) startExt(); });
    $('#mediaAllow').onclick = () => plugin().openSettings();
  }

  /* ---------- Fonte local (arquivos) ---------- */
  function renderTracks() {
    const box = $('#tracks'); box.innerHTML = '';
    tracks.forEach((t, i) => {
      const d = document.createElement('div');
      d.className = 'trk' + (source === 'local' && i === cur ? ' cur' : '');
      d.textContent = t.name;
      d.onclick = () => playLocal(i);
      box.appendChild(d);
    });
  }
  function playLocal(i) {
    if (!tracks.length) return;
    if (source === 'ext' && ext.playing) plugin()?.control({ action: 'pause' });
    source = 'local';
    cur = (i + tracks.length) % tracks.length;
    audio.src = tracks[cur].url;
    audio.play().catch(() => {});
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: tracks[cur].name, artist: 'Agile Dash' });
    renderTracks(); render();
  }
  $('#files').onchange = e => {
    tracks = [...e.target.files].map(f => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
    renderTracks();
    if (tracks.length) playLocal(0);
  };
  audio.onplay = audio.onpause = audio.ontimeupdate = () => { if (source === 'local') render(); };
  audio.onended = () => playLocal(cur + 1);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('nexttrack', () => playLocal(cur + 1));
    navigator.mediaSession.setActionHandler('previoustrack', () => playLocal(cur - 1));
  }

  /* ---------- Controles ---------- */
  function control(action) {
    if (source === 'local' && tracks.length) {
      if (action === 'play') audio.paused ? audio.play() : audio.pause();
      else playLocal(cur + (action === 'next' ? 1 : -1));
      return;
    }
    if (isNative()) {
      plugin().control({ action: action === 'play' ? 'toggle' : action }).catch(() => {});
      return;
    }
    go('music');
  }
  $$('[data-m]').forEach(b => b.onclick = e => { e.stopPropagation(); control(b.dataset.m); });

  $('#seek').oninput = () => { seeking = true; };
  $('#seek').onchange = e => {
    seeking = false;
    const f = e.target.value / 100;
    if (source === 'local') { if (audio.duration) audio.currentTime = f * audio.duration; }
    else if (ext.duration) plugin()?.control({ action: 'seek', position: Math.round(f * ext.duration) });
  };

  // Tocar na capa abre o app que está tocando (ex.: Spotify)
  for (const el of [$('#art'), $('#art2')]) {
    el.onclick = e => {
      e.stopPropagation();
      if (source === 'ext' && ext.pkg) openApp(ext.pkg);
      else go('music');
    };
  }
  $('#miniPlayer').onclick = () => go('music');

  render();
}
