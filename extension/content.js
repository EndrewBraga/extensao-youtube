// Botão flutuante que abre um cartão de download, visível só em páginas de vídeo (/watch).
// Fica em um Shadow DOM para o CSS do YouTube não interferir (e vice-versa).
const QUALITIES = {
  video: [
    ['best', 'Melhor disponível'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p'],
    ['720', '720p'], ['480', '480p'], ['360', '360p'],
  ],
  audio: [
    ['best', 'Melhor (VBR)'], ['320', '320 kbps'], ['192', '192 kbps'], ['128', '128 kbps'],
  ],
};
const LABELS = { video: 'MP4', audio: 'MP3' };

// As escolhas ficam no localStorage do youtube.com (sem permissão extra).
const load = (key, fallback) => {
  try { return localStorage.getItem('ytdl:' + key) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem('ytdl:' + key, value); } catch { /* sem armazenamento */ }
};

const CSS = `
:host { all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  font: 400 13px/1.4 Roboto, "Segoe UI", Arial, sans-serif; color: #f1f1f1; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, select, input { font: inherit; color: inherit; }
button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible,
.switch input:focus-visible + .track { outline: 2px solid #8ab4ff; outline-offset: 2px; }

.wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }

.fab { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px 0 14px;
  border: 0; border-radius: 22px; background: #e53935; color: #fff; font-weight: 500;
  box-shadow: 0 4px 14px rgba(0,0,0,.45); cursor: pointer; transition: background .15s, transform .1s; }
.fab:hover { background: #f44336; }
.fab:active { transform: scale(.97); }
.fab svg { width: 20px; height: 20px; }

.card { width: 300px; max-height: calc(100vh - 110px); overflow-y: auto; padding: 16px; border-radius: 16px;
  background: #1f1f1f; border: 1px solid rgba(255,255,255,.1); box-shadow: 0 12px 32px rgba(0,0,0,.55);
  display: flex; flex-direction: column; gap: 14px; scrollbar-width: thin; }
.card > * { flex-shrink: 0; }

.head { display: flex; align-items: center; justify-content: space-between; }
.head h2 { margin: 0; font-size: 15px; font-weight: 500; }
.close { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 50%;
  background: transparent; color: #aaa; cursor: pointer; }
.close:hover { background: rgba(255,255,255,.1); color: #fff; }
.close svg { width: 16px; height: 16px; }

.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px;
  border-radius: 12px; background: #121212; }
.tab { padding: 8px 0; border: 0; border-radius: 9px; background: transparent; color: #aaa;
  font-weight: 500; cursor: pointer; transition: background .15s, color .15s; }
.tab:hover:not(:disabled) { color: #fff; }
.tab[aria-selected="true"] { background: #3a3a3a; color: #fff; }
.tab:disabled { cursor: default; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field > span, .switch-text span, .hint { font-size: 12px; color: #aaa; }
.select, .input { width: 100%; height: 40px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px;
  background-color: #2a2a2a; }
.select { padding: 0 36px 0 12px; appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23aaa'%3E%3Cpath d='M5 7l5 6 5-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center; background-size: 18px; }
.input { height: 36px; padding: 0 10px; }
.input::placeholder { color: #777; }
.select:hover:not(:disabled), .input:hover:not(:disabled) { border-color: rgba(255,255,255,.3); }
.select:disabled, .input:disabled { opacity: .55; cursor: default; }

.note { margin: 0; min-height: 36px; display: flex; align-items: center; font-size: 12px; color: #aaa; }
.hint { margin: 0; }
.switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
.switch-text { display: flex; flex-direction: column; }
.switch-text b { font-weight: 500; }
.switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.track { position: relative; flex: none; width: 38px; height: 22px; border-radius: 11px;
  background: #4a4a4a; transition: background .15s; }
.track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform .15s; }
.switch input:checked + .track { background: #e53935; }
.switch input:checked + .track::after { transform: translateX(16px); }
.switch input:disabled + .track { opacity: .55; }

.go { display: flex; align-items: center; justify-content: center; gap: 8px; height: 44px; border: 0;
  border-radius: 12px; background: #e53935; color: #fff; font-weight: 500; cursor: pointer;
  transition: background .15s; }
.go:hover:not(:disabled) { background: #f44336; }
.go:disabled { background: #5a2a29; color: #ddd; cursor: default; }
.go svg { width: 18px; height: 18px; }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
  border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.progress { display: flex; flex-direction: column; gap: 6px; }
.plabel { display: flex; justify-content: space-between; font-size: 12px; }
.pct, .meta { color: #aaa; font-variant-numeric: tabular-nums; }
.bar { height: 6px; border-radius: 3px; background: #3a3a3a; overflow: hidden; }
.bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: #e53935; transition: width .25s; }
.bar.indet i { width: 40%; transition: none; animation: slide 1.1s ease-in-out infinite; }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.meta { font-size: 11px; min-height: 15px; }

.status { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 12px;
  border-radius: 10px; font-size: 12px; background: rgba(255,255,255,.06); word-break: break-word; }
.status[data-state="ok"] { background: rgba(76,175,80,.16); color: #a5d6a7; }
.status[data-state="err"] { background: rgba(244,67,54,.16); color: #ffab91; }
.status .msg { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }

.link { padding: 0; border: 0; background: none; color: #8ab4ff; font-size: 12px; text-align: left;
  text-decoration: underline; cursor: pointer; }
.link:hover { color: #b3cdff; }

.more { border-top: 1px solid rgba(255,255,255,.1); padding-top: 12px; }
.more summary { cursor: pointer; color: #bbb; font-weight: 500; list-style: none; user-select: none; }
.more summary::-webkit-details-marker { display: none; }
.more summary::before { content: "▸ "; }
.more[open] summary::before { content: "▾ "; }
.more-body { display: flex; flex-direction: column; gap: 14px; margin-top: 12px; }
.group { display: flex; flex-direction: column; gap: 10px; }
.group-title { font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: #8a8a8a; }
.range { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
`;

const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>';

const host = document.createElement('div');
host.id = 'ytdl-root';
host.hidden = true;
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
<style>${CSS}</style>
<div class="wrap">
  <section class="card" role="dialog" aria-label="Baixar vídeo" hidden>
    <div class="head">
      <h2>Baixar este vídeo</h2>
      <button type="button" class="close" aria-label="Fechar">${ICON_CLOSE}</button>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" data-mode="video">Vídeo · MP4</button>
      <button type="button" class="tab" role="tab" data-mode="audio">Áudio · MP3</button>
    </div>
    <label class="field">
      <span class="quality-label"></span>
      <select class="select"></select>
    </label>
    <label class="switch" data-only="video" title="Mais compatível com players e TVs, mas limita a cerca de 1080p">
      <span class="switch-text"><b>Preferir H.264</b><span>Mais compatível, até ~1080p</span></span>
      <input type="checkbox" class="h264"><span class="track"></span>
    </label>
    <p class="note" data-only="audio">Convertido do áudio original do YouTube; bitrates altos só aumentam o arquivo.</p>
    <button type="button" class="go"></button>
    <div class="progress" hidden>
      <div class="plabel"><span class="stage"></span><span class="pct"></span></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      <div class="meta"></div>
    </div>
    <div class="status" hidden aria-live="polite">
      <span class="msg"></span>
      <button type="button" class="link reveal" hidden>Mostrar na pasta</button>
    </div>
    <details class="more">
      <summary>Mais opções</summary>
      <div class="more-body">
        <div class="group">
          <div class="group-title">Trecho (opcional)</div>
          <div class="range">
            <label class="field"><span>Início</span><input class="input start" placeholder="0:30" inputmode="numeric" autocomplete="off"></label>
            <label class="field"><span>Fim</span><input class="input end" placeholder="1:45" inputmode="numeric" autocomplete="off"></label>
          </div>
          <p class="hint">Vazio = vídeo inteiro. Aceita 90, 1:30 ou 1:02:03. Cortar refaz o trecho e demora mais.</p>
          <label class="switch" title="Remove sponsor, autopromoção e pedidos de interação (SponsorBlock)">
            <span class="switch-text"><b>Remover patrocínios do arquivo</b><span>Usa o SponsorBlock; mais lento</span></span>
            <input type="checkbox" class="dl-sponsor"><span class="track"></span>
          </label>
        </div>
        <div class="group yt-options"><div class="group-title">No YouTube</div></div>
        <button type="button" class="link open-folder">Abrir pasta de downloads</button>
      </div>
    </details>
  </section>
  <button type="button" class="fab" aria-expanded="false">${ICON_DOWNLOAD}<span>Baixar</span></button>
</div>`;

const $ = (sel) => root.querySelector(sel);
const card = $('.card');
const fab = $('.fab');
const select = $('.select');
const h264 = $('.h264');
const go = $('.go');
const status = $('.status');
const reveal = $('.reveal');
const startInput = $('.start');
const endInput = $('.end');
const dlSponsor = $('.dl-sponsor');
const tabs = [...root.querySelectorAll('.tab')];

let mode = load('mode', 'video') === 'audio' ? 'audio' : 'video';
let busy = false;
let lastFile = null;

function renderMode() {
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
  $('.quality-label').textContent = mode === 'video' ? 'Resolução máxima' : 'Qualidade do MP3';
  select.replaceChildren(...QUALITIES[mode].map(([value, label]) => new Option(label, value)));
  const saved = load(mode, 'best');
  select.value = QUALITIES[mode].some(([v]) => v === saved) ? saved : 'best';
  root.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== mode; });
  go.replaceChildren();
  go.insertAdjacentHTML('beforeend', ICON_DOWNLOAD);
  go.append(`Baixar ${LABELS[mode]}`);
}

function setStatus(state, text, title = '', file = null) {
  status.hidden = !state;
  status.dataset.state = state || '';
  $('.msg').textContent = text || '';
  status.title = title;
  lastFile = file;
  reveal.hidden = !file;
}

const STAGES = {
  video: 'Baixando vídeo',
  audio: 'Baixando áudio',
  merge: 'Juntando vídeo e áudio…',
  convert: 'Convertendo para MP3…',
  sponsor: 'Buscando patrocínios…',
  cut: 'Removendo patrocínios…',
  update: 'Atualizando o yt-dlp…',
  retry: 'Tentando de novo…',
};

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '';
  const mb = bytesPerSec / 1048576;
  return (mb >= 1 ? mb.toFixed(1) + ' MB/s' : Math.round(bytesPerSec / 1024) + ' KB/s').replace('.', ',');
}

function formatEta(seconds) {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function renderProgress({ stage, percent, speed, eta } = {}) {
  const bar = $('.bar');
  const known = typeof percent === 'number';
  $('.stage').textContent = STAGES[stage] || 'Preparando…';
  $('.pct').textContent = known ? Math.floor(percent) + '%' : '';
  $('.bar i').style.width = known ? percent + '%' : '';
  bar.classList.toggle('indet', !known);
  if (known) bar.setAttribute('aria-valuenow', String(Math.floor(percent)));
  else bar.removeAttribute('aria-valuenow');
  const details = [formatSpeed(speed), eta != null ? 'faltam ' + formatEta(eta) : ''].filter(Boolean);
  $('.meta').textContent = details.join(' · ');
}

function setBusy(value) {
  busy = value;
  $('.progress').hidden = !value;
  if (value) renderProgress();
  [...tabs, select, h264, go, startInput, endInput, dlSponsor].forEach((el) => { el.disabled = value; });
  if (value) {
    go.replaceChildren();
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    go.append(spinner, 'Baixando…');
  } else {
    renderMode();
  }
}

async function start() {
  // URL canônica, sem parâmetros de playlist/tempo
  const url = 'https://www.youtube.com/watch?v=' + new URLSearchParams(location.search).get('v');
  const options = { quality: select.value, sponsorblock: dlSponsor.checked };
  if (mode === 'video') options.h264 = h264.checked;
  if (startInput.value.trim()) options.start = startInput.value.trim();
  if (endInput.value.trim()) options.end = endInput.value.trim();
  setStatus(null);
  setBusy(true);
  try {
    const res = await chrome.runtime.sendMessage({ type: 'download', url, mode, ...options });
    if (res?.ok) {
      const name = res.file.split(/[\\/]/).pop();
      setStatus('ok', 'Concluído: ' + name, res.file, res.file);
    } else {
      const error = res?.error || 'Sem resposta do service worker';
      setStatus('err', error, error);
    }
  } catch (e) {
    setStatus('err', 'Recarregue a página do YouTube e tente de novo.', e.message); // extensão foi recarregada
  }
  setBusy(false);
}

async function openInExplorer(target, file) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'open', target, file });
    if (!res?.ok) setStatus('err', res?.error || 'Não consegui abrir o Explorer', res?.error || '');
  } catch (e) {
    setStatus('err', 'Recarregue a página do YouTube e tente de novo.', e.message);
  }
}

function toggle(open) {
  card.hidden = !open;
  fab.setAttribute('aria-expanded', String(open));
}

// ---------- chaves "No YouTube" ----------

function addSwitch({ label, hint = '', checked, disabled = false, onChange }) {
  const row = document.createElement('label');
  row.className = 'switch';
  row.innerHTML = '<span class="switch-text"><b></b><span></span></span><input type="checkbox"><span class="track"></span>';
  row.querySelector('b').textContent = label;
  const hintEl = row.querySelector('.switch-text span');
  hintEl.textContent = hint;
  hintEl.hidden = !hint;
  const input = row.querySelector('input');
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  $('.yt-options').append(row);
}

// adblock.js e declutter.js (document_start) já criaram os objetos globais e aplicaram as escolhas salvas.
addSwitch({
  label: 'Bloquear anúncios',
  hint: 'Esconde e pula anúncios do YouTube',
  checked: globalThis.ytAdblock?.enabled ?? false,
  disabled: !globalThis.ytAdblock,
  onChange: (on) => globalThis.ytAdblock?.setEnabled(on),
});

let sponsorSkip = load('sponsorskip', '1') === '1';
addSwitch({
  label: 'Pular patrocínios',
  hint: 'SponsorBlock, ao assistir',
  checked: sponsorSkip,
  onChange: (on) => {
    sponsorSkip = on;
    save('sponsorskip', on ? '1' : '0');
    if (on) loadSponsorSegments();
  },
});

for (const option of globalThis.ytDeclutter?.options ?? []) {
  addSwitch({
    label: option.label,
    checked: globalThis.ytDeclutter.isOn(option.key),
    onChange: (on) => globalThis.ytDeclutter.set(option.key, on),
  });
}

// ---------- pular patrocínios (SponsorBlock) ----------

const sponsorState = { videoId: null, segments: [] };

const toastHost = document.createElement('div');
toastHost.id = 'ytdl-toast';
const toastRoot = toastHost.attachShadow({ mode: 'open' });
toastRoot.innerHTML = `<style>
:host { all: initial; position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
  z-index: 2147483647; pointer-events: none; font: 500 13px/1 Roboto, "Segoe UI", Arial, sans-serif; }
.t { padding: 10px 16px; border-radius: 18px; background: rgba(20,20,20,.92); color: #fff;
  box-shadow: 0 4px 14px rgba(0,0,0,.45); opacity: 0; transition: opacity .2s; }
.t.show { opacity: 1; }
</style><div class="t"></div>`;
let toastTimer = null;
function toast(text) {
  const el = toastRoot.querySelector('.t');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

const currentVideoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

async function loadSponsorSegments() {
  const id = currentVideoId();
  if (!id || !sponsorSkip || sponsorState.videoId === id) return;
  sponsorState.videoId = id;
  sponsorState.segments = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'sponsorSegments', videoId: id });
    if (res?.ok && sponsorState.videoId === id) sponsorState.segments = res.segments;
  } catch { /* extensão recarregada: sem trechos */ }
}

// timeupdate não borbulha, então escuta na captura. Só o player principal e só fora de anúncio.
document.addEventListener('timeupdate', (event) => {
  if (!sponsorSkip || sponsorState.segments.length === 0) return;
  const video = event.target;
  if (!(video instanceof HTMLVideoElement) || !video.closest('#movie_player')) return;
  if (document.querySelector('#movie_player.ad-showing')) return;
  const end = ytSponsor.findSkip(sponsorState.segments, video.currentTime);
  if (end === null) return;
  video.currentTime = end;
  toast('Patrocínio pulado');
}, true);

// ---------- eventos do painel ----------

tabs.forEach((t) => t.addEventListener('click', () => {
  mode = t.dataset.mode;
  save('mode', mode);
  renderMode();
}));
select.addEventListener('change', () => save(mode, select.value));
h264.checked = load('h264', '0') === '1';
h264.addEventListener('change', () => save('h264', h264.checked ? '1' : '0'));
dlSponsor.checked = load('dlsponsor', '0') === '1';
dlSponsor.addEventListener('change', () => save('dlsponsor', dlSponsor.checked ? '1' : '0'));
go.addEventListener('click', start);
reveal.addEventListener('click', () => lastFile && openInExplorer('file', lastFile));
$('.open-folder').addEventListener('click', () => openInExplorer('folder'));
// Progresso enviado pelo service worker durante o download.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'progress' && busy) renderProgress(msg);
});
fab.addEventListener('click', () => toggle(card.hidden));
$('.close').addEventListener('click', () => { toggle(false); fab.focus(); });
card.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });

renderMode();
document.documentElement.append(host, toastHost);

// O YouTube é uma SPA: a página não recarrega entre vídeos.
let shownVideoId = null;
function refresh() {
  const id = currentVideoId();
  // Em tela cheia o painel cobriria os controles do player, então fica escondido.
  host.hidden = !id || Boolean(document.fullscreenElement);
  if (!id && !busy) { toggle(false); setStatus(null); }
  if (id !== shownVideoId) {
    shownVideoId = id;
    startInput.value = '';
    endInput.value = '';
    if (!busy) setStatus(null);
  }
  loadSponsorSegments();
}
document.addEventListener('fullscreenchange', refresh);
document.addEventListener('yt-navigate-finish', refresh);
window.addEventListener('popstate', refresh);
refresh();
