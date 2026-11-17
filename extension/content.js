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
:host { all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;
  font: 400 14px/1.4 Roboto, "Segoe UI", Arial, sans-serif; color: #f5f5f5; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, select, input { font: inherit; color: inherit; }
button:focus-visible, select:focus-visible, input:focus-visible,
.row input:focus-visible + .track { outline: 2px solid #8ab4ff; outline-offset: 2px; }

.wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }

.fab { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px 0 14px;
  border: 0; border-radius: 22px; background: #d32f2f; color: #fff; font-weight: 500;
  box-shadow: 0 4px 14px rgba(0,0,0,.45); cursor: pointer; transition: background .15s, transform .1s; }
.fab:hover { background: #c62828; }
.fab:active { transform: scale(.97); }
.fab svg { width: 20px; height: 20px; }

.card { width: 360px; max-height: calc(100vh - 120px); overflow-y: auto; padding: 20px; border-radius: 20px;
  background: #181818; border: 1px solid rgba(255,255,255,.08); box-shadow: 0 16px 40px rgba(0,0,0,.6);
  display: flex; flex-direction: column; gap: 20px; scrollbar-width: thin; }
.card > * { flex-shrink: 0; }
.card.busy .dim { opacity: .45; pointer-events: none; }

.head { display: flex; align-items: center; gap: 8px; }
.head-text { flex: 1; min-width: 0; }
.head h2 { margin: 0; font-size: 17px; font-weight: 500; }
.video-title { font-size: 13px; color: #a0a0a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.close { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 50%;
  background: transparent; color: #a0a0a0; cursor: pointer; }
.close:hover { background: rgba(255,255,255,.08); color: #fff; }
.close svg { width: 18px; height: 18px; }

.label { margin-bottom: 8px; font-size: 12px; color: #8c8c8c; }
.stack { display: flex; flex-direction: column; gap: 10px; }

.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px;
  border-radius: 14px; background: #101010; }
.tab { height: 36px; border: 0; border-radius: 10px; background: transparent; color: #a0a0a0;
  font-size: 14px; font-weight: 500; cursor: pointer; transition: background .15s, color .15s; }
.tab:hover:not(:disabled) { color: #fff; }
.tab[aria-selected="true"] { background: #2f2f2f; color: #fff; }
.tab:disabled { cursor: default; }

.select, .input { width: 100%; height: 44px; border: 1px solid rgba(255,255,255,.08); border-radius: 14px;
  background-color: #232323; font-size: 14px; }
.select { padding: 0 40px 0 14px; appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23a0a0a0'%3E%3Cpath d='M5 7l5 6 5-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center; background-size: 18px; }
.input { padding: 0 14px; }
.input::placeholder { color: #8c8c8c; }
.select:hover:not(:disabled), .input:hover:not(:disabled) { border-color: rgba(255,255,255,.2); }
.select:disabled, .input:disabled { cursor: default; }

.note { margin: 0; min-height: 56px; display: flex; align-items: center; font-size: 12px; color: #a0a0a0; }
.hint { margin: 8px 0 0; font-size: 12px; color: #a0a0a0; }

.list { border-radius: 14px; background: #232323; overflow: hidden; }
.list .row + .row { border-top: 1px solid rgba(255,255,255,.06); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px;
  padding: 8px 16px; cursor: pointer; }
.row-text { display: flex; flex-direction: column; }
.row-sub { font-size: 12px; color: #a0a0a0; }
.row input { position: absolute; opacity: 0; width: 0; height: 0; }
.track { position: relative; flex: none; width: 44px; height: 26px; border: 2px solid #8c8c8c; border-radius: 13px;
  background: transparent; transition: background .15s, border-color .15s; }
.track::after { content: ""; position: absolute; top: 5px; left: 5px; width: 12px; height: 12px; border-radius: 50%;
  background: #8c8c8c; transition: transform .15s, width .15s, height .15s, top .15s, left .15s, background .15s; }
.row input:checked + .track { background: #f0f0f0; border-color: #f0f0f0; }
.row input:checked + .track::after { top: 3px; left: 3px; width: 16px; height: 16px; background: #181818;
  transform: translateX(17px); }
.row input:disabled + .track { opacity: .55; }

.go { display: flex; align-items: center; justify-content: center; gap: 8px; height: 52px; border: 0;
  border-radius: 14px; background: #d32f2f; color: #fff; font-size: 16px; font-weight: 500; cursor: pointer;
  transition: background .15s; }
.go:hover { background: #c62828; }
.go svg { width: 20px; height: 20px; }

.progress { display: flex; flex-direction: column; gap: 10px; }
.pbar { position: relative; height: 52px; border-radius: 14px; background: #2b2b2b; overflow: hidden; }
.fill { position: absolute; top: 0; bottom: 0; left: 0; width: 0; background: #d32f2f; transition: width .25s; }
.pbar.indet .fill { width: 40%; transition: none; animation: slide 1.1s ease-in-out infinite; }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.plabel { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
  font-size: 16px; font-weight: 500; color: #fff; }
.pct { opacity: .85; font-weight: 400; font-variant-numeric: tabular-nums; }
.meta { display: flex; justify-content: space-between; min-height: 17px; font-size: 12px; color: #a0a0a0;
  font-variant-numeric: tabular-nums; }

.status { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 14px;
  background: rgba(76,175,80,.12); border: 1px solid rgba(76,175,80,.28); }
.status[data-state="err"] { background: rgba(244,67,54,.12); border-color: rgba(244,67,54,.3); }
.st-row { display: flex; align-items: flex-start; gap: 12px; }
.st-icon { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%;
  background: #2e7d32; color: #fff; font-size: 14px; font-weight: 700; }
.status[data-state="err"] .st-icon { background: #c62828; }
.st-text { min-width: 0; }
.st-title { font-weight: 500; color: #e6f4e7; }
.status[data-state="err"] .st-title { color: #ffd9d4; }
.st-msg { font-size: 12px; color: #a5d6a7; word-break: break-word; display: -webkit-box;
  -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.status[data-state="err"] .st-msg { color: #ffab91; }
.st-sub { margin-top: 2px; font-size: 12px; color: #a0a0a0; }
.outline { display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px;
  border: 1px solid rgba(255,255,255,.18); border-radius: 12px; background: transparent; font-size: 14px;
  font-weight: 500; cursor: pointer; }
.outline:hover { background: rgba(255,255,255,.06); }
.outline svg { width: 18px; height: 18px; }

.more { display: flex; flex-direction: column; gap: 20px; }
.more-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 12px 0 0; border: 0; border-top: 1px solid rgba(255,255,255,.08); background: none;
  text-align: left; cursor: pointer; }
.more-text { display: flex; flex-direction: column; }
.more-title { font-size: 14px; font-weight: 500; }
.more-sub { font-size: 12px; color: #a0a0a0; }
.chev { width: 20px; height: 20px; flex: none; color: #a0a0a0; transition: transform .15s; }
.more-toggle[aria-expanded="true"] .chev { transform: rotate(180deg); }
.more-body { display: flex; flex-direction: column; gap: 20px; }
.range { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 12px; color: #a0a0a0; }
.folder { display: flex; align-items: center; gap: 12px; width: 100%; height: 52px; padding: 0 16px;
  border: 0; border-radius: 14px; background: #232323; font-size: 14px; text-align: left; cursor: pointer; }
.folder:hover { background: #2a2a2a; }
.folder svg { width: 20px; height: 20px; flex: none; color: #a0a0a0; }
.folder span { flex: 1; }
`;

const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
const ICON_CHEVRON_DOWN = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

const host = document.createElement('div');
host.id = 'ytdl-root';
host.hidden = true;
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
<style>${CSS}</style>
<div class="wrap">
  <section class="card" role="dialog" aria-label="Baixar vídeo" hidden>
    <div class="head">
      <div class="head-text">
        <h2>Baixar este vídeo</h2>
        <div class="video-title"></div>
      </div>
      <button type="button" class="close" aria-label="Fechar">${ICON_CLOSE}</button>
    </div>

    <div class="dim">
      <div class="label">Formato</div>
      <div class="tabs" role="tablist" aria-label="Formato">
        <button type="button" class="tab" role="tab" data-mode="video">Vídeo (MP4)</button>
        <button type="button" class="tab" role="tab" data-mode="audio">Áudio (MP3)</button>
      </div>
    </div>

    <div class="dim">
      <div class="label">Qualidade</div>
      <div class="stack">
        <select class="select"></select>
        <div class="list list-quality" data-only="video"></div>
        <p class="note" data-only="audio">Convertido do áudio original do YouTube; bitrates altos só aumentam o arquivo.</p>
      </div>
    </div>

    <button type="button" class="go"></button>
    <div class="progress" hidden>
      <div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso do download">
        <div class="fill"></div>
        <div class="plabel"><span class="stage"></span><span class="pct"></span></div>
      </div>
      <div class="meta"><span class="speed"></span><span class="eta"></span></div>
    </div>

    <div class="status" hidden aria-live="polite">
      <div class="st-row">
        <span class="st-icon" aria-hidden="true"></span>
        <div class="st-text">
          <div class="st-title"></div>
          <div class="st-msg"></div>
          <div class="st-sub" hidden>Salvo em Downloads\\YouTube</div>
        </div>
      </div>
      <button type="button" class="outline reveal" hidden>${ICON_FOLDER}Mostrar na pasta</button>
    </div>

    <div class="more dim">
      <button type="button" class="more-toggle" aria-expanded="false">
        <span class="more-text">
          <span class="more-title">Mais opções</span>
          <span class="more-sub">Trecho, patrocínios e ajustes do YouTube</span>
        </span>
        ${ICON_CHEVRON_DOWN}
      </button>
      <div class="more-body" hidden>
        <div>
          <div class="label">Cortar trecho</div>
          <div class="range">
            <label class="field"><span>Início</span><input class="input start" placeholder="0:30" inputmode="numeric" autocomplete="off"></label>
            <label class="field"><span>Fim</span><input class="input end" placeholder="1:45" inputmode="numeric" autocomplete="off"></label>
          </div>
          <p class="hint">Deixe vazio para baixar o vídeo inteiro.</p>
        </div>
        <div>
          <div class="label">Patrocínios</div>
          <div class="list list-sponsor"></div>
        </div>
        <div>
          <div class="label">No YouTube</div>
          <div class="list yt-options"></div>
        </div>
        <button type="button" class="folder open-folder">${ICON_FOLDER}<span>Abrir pasta de downloads</span>${ICON_CHEVRON_RIGHT}</button>
      </div>
    </div>
  </section>
  <button type="button" class="fab" aria-expanded="false">${ICON_DOWNLOAD}<span>Baixar</span></button>
</div>`;

const $ = (sel) => root.querySelector(sel);
const card = $('.card');
const fab = $('.fab');
const select = $('.select');
const go = $('.go');
const status = $('.status');
const reveal = $('.reveal');
const startInput = $('.start');
const endInput = $('.end');
const tabs = [...root.querySelectorAll('.tab')];
const moreToggle = $('.more-toggle');

// Uma linha de lista com chave liga/desliga. Devolve o <input> para quem precisa ler o valor.
function addRow(list, { title, sub = '', checked, disabled = false, onChange }) {
  const row = document.createElement('label');
  row.className = 'row';
  row.innerHTML = '<span class="row-text"><span class="row-title"></span><span class="row-sub"></span></span><input type="checkbox"><span class="track"></span>';
  row.querySelector('.row-title').textContent = title;
  const subEl = row.querySelector('.row-sub');
  subEl.textContent = sub;
  subEl.hidden = !sub;
  const input = row.querySelector('input');
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  list.append(row);
  return input;
}

const h264 = addRow($('.list-quality'), {
  title: 'Preferir H.264',
  sub: 'Mais compatível com TVs e players',
  checked: load('h264', '0') === '1',
  onChange: (on) => save('h264', on ? '1' : '0'),
});

const dlSponsor = addRow($('.list-sponsor'), {
  title: 'Remover do arquivo baixado',
  sub: 'Demora um pouco mais',
  checked: load('dlsponsor', '0') === '1',
  onChange: (on) => save('dlsponsor', on ? '1' : '0'),
});

let mode = load('mode', 'video') === 'audio' ? 'audio' : 'video';
let busy = false;
let lastFile = null;

function renderMode() {
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
  select.setAttribute('aria-label', mode === 'video' ? 'Resolução máxima' : 'Qualidade do MP3');
  select.replaceChildren(...QUALITIES[mode].map(([value, label]) => new Option(label, value)));
  const saved = load(mode, 'best');
  select.value = QUALITIES[mode].some(([v]) => v === saved) ? saved : 'best';
  root.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== mode; });
  go.replaceChildren();
  go.insertAdjacentHTML('beforeend', ICON_DOWNLOAD);
  go.append(`Baixar ${LABELS[mode]}`);
}

// state: 'ok' | 'err' | null (esconde). Em 'ok', `text` é o nome do arquivo e `file` o caminho completo.
function setStatus(state, text, title = '', file = null) {
  status.hidden = !state;
  status.dataset.state = state || '';
  $('.st-icon').textContent = state === 'err' ? '!' : '✓';
  $('.st-title').textContent = state === 'err' ? 'Não foi possível baixar' : 'Download concluído';
  $('.st-msg').textContent = text || '';
  $('.st-sub').hidden = state !== 'ok';
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
  const bar = $('.pbar');
  const known = typeof percent === 'number';
  $('.stage').textContent = STAGES[stage] || 'Preparando…';
  $('.pct').textContent = known ? Math.floor(percent) + '%' : '';
  $('.fill').style.width = known ? percent + '%' : '';
  bar.classList.toggle('indet', !known);
  if (known) bar.setAttribute('aria-valuenow', String(Math.floor(percent)));
  else bar.removeAttribute('aria-valuenow');
  $('.speed').textContent = formatSpeed(speed);
  $('.eta').textContent = eta != null ? 'faltam ' + formatEta(eta) : '';
}

function setBusy(value) {
  busy = value;
  card.classList.toggle('busy', value);
  $('.progress').hidden = !value;
  go.hidden = value;
  if (value) renderProgress();
  else renderMode();
  [...tabs, select, h264, startInput, endInput, dlSponsor].forEach((el) => { el.disabled = value; });
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
      setStatus('ok', name, res.file, res.file);
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

const pageTitle = () => document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();
const updateTitle = () => { $('.video-title').textContent = pageTitle(); };

function toggle(open) {
  if (open) updateTitle();
  card.hidden = !open;
  fab.setAttribute('aria-expanded', String(open));
}

function toggleMore(open) {
  moreToggle.setAttribute('aria-expanded', String(open));
  $('.more-body').hidden = !open;
  $('.more-sub').hidden = open;
  save('more', open ? '1' : '0');
}

// ---------- chaves de patrocínios e "No YouTube" ----------

// adblock.js e declutter.js (document_start) já criaram os objetos globais e aplicaram as escolhas salvas.
let sponsorSkip = load('sponsorskip', '1') === '1';
addRow($('.list-sponsor'), {
  title: 'Pular ao assistir',
  sub: 'Usa o SponsorBlock',
  checked: sponsorSkip,
  onChange: (on) => {
    sponsorSkip = on;
    save('sponsorskip', on ? '1' : '0');
    if (on) loadSponsorSegments();
  },
});

addRow($('.yt-options'), {
  title: 'Bloquear anúncios',
  checked: globalThis.ytAdblock?.enabled ?? false,
  disabled: !globalThis.ytAdblock,
  onChange: (on) => globalThis.ytAdblock?.setEnabled(on),
});

for (const option of globalThis.ytDeclutter?.options ?? []) {
  addRow($('.yt-options'), {
    title: option.label,
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
go.addEventListener('click', start);
reveal.addEventListener('click', () => lastFile && openInExplorer('file', lastFile));
$('.open-folder').addEventListener('click', () => openInExplorer('folder'));
moreToggle.addEventListener('click', () => toggleMore(moreToggle.getAttribute('aria-expanded') !== 'true'));
// Progresso enviado pelo service worker durante o download.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'progress' && busy) renderProgress(msg);
});
fab.addEventListener('click', () => toggle(card.hidden));
$('.close').addEventListener('click', () => { toggle(false); fab.focus(); });
card.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });

renderMode();
toggleMore(load('more', '0') === '1');
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
  updateTitle();
  loadSponsorSegments();
}
document.addEventListener('fullscreenchange', refresh);
document.addEventListener('yt-navigate-finish', refresh);
window.addEventListener('popstate', refresh);
refresh();
