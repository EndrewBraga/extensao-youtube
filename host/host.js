'use strict';
// Host nativo (Native Messaging) que chama o yt-dlp local.
// stdout é reservado ao protocolo do Chrome: nunca use console.log aqui.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALLOWED_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
]);
const MAX_MESSAGE_BYTES = 1024 * 1024; // limite do Chrome para mensagens enviadas ao host
const TIMEOUT_MS = 60 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 2 * 60 * 1000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // no máximo uma atualização automática a cada 6h
const SPONSORBLOCK_CATEGORIES = 'sponsor,selfpromo,interaction';

// Erros que atualizar o yt-dlp não resolve: vídeo realmente indisponível, privado etc.
const PERMANENT_ERROR = /unavailable|private|members|removed|terminated|copyright|age[- ]restricted|not available in your country|not a valid url|premiere|live event/i;

// Linhas de progresso do yt-dlp, com prefixo para distinguir do caminho final do arquivo.
const DL_PREFIX = 'YTDLP_DL|';
const PP_PREFIX = 'YTDLP_PP|';
const DL_FIELDS = ['downloaded_bytes', 'total_bytes', 'total_bytes_estimate', 'speed', 'eta']
  .map((f) => '%(progress.' + f + ')s').concat('%(info.vcodec)s').join('|');

const HEAD_ARGS = ['--no-playlist', '--windows-filenames', '--embed-metadata'];
const TAIL_ARGS = [
  '--print', 'after_move:filepath',
  '--newline', '--progress',
  '--progress-template', 'download:' + DL_PREFIX + DL_FIELDS,
  '--progress-template', 'postprocess:' + PP_PREFIX + '%(progress.postprocessor)s|%(progress.status)s',
  // Sem isso a saída vem na página de código do console e acentos do caminho final viram U+FFFD.
  '--encoding', 'utf-8',
];
const VIDEO_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360']; // altura máxima
const AUDIO_QUALITIES = ['best', '320', '192', '128']; // kbps do MP3 (best = VBR V0)
const DEFAULT_QUALITY = 'best';

// ---------- protocolo ----------

// Lê exatamente n bytes. Devolve null se o stream acabou antes do primeiro byte.
function readExact(stream, n) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('readable', attempt);
      stream.off('end', onEnd);
    };
    const attempt = () => {
      const chunk = stream.read(n);
      if (!chunk) return;
      cleanup();
      if (chunk.length < n) reject(new Error('Mensagem truncada')); // stream acabou no meio
      else resolve(chunk);
    };
    const onEnd = () => {
      cleanup();
      const rest = stream.read();
      reject(new Error(rest ? 'Mensagem truncada' : 'EOF'));
    };
    if (stream.readableEnded) { reject(new Error('EOF')); return; }
    stream.on('readable', attempt);
    stream.on('end', onEnd);
    attempt();
  });
}

// Devolve o objeto JSON da próxima mensagem, ou null em EOF limpo.
async function readMessage(stream) {
  let header;
  try {
    header = await readExact(stream, 4);
  } catch (err) {
    if (err.message === 'EOF') return null;
    throw err;
  }
  const length = header.readUInt32LE(0);
  if (length > MAX_MESSAGE_BYTES) throw new Error('Mensagem grande demais');
  if (length === 0) throw new Error('Mensagem vazia');
  let body;
  try {
    body = await readExact(stream, length);
  } catch (err) {
    throw new Error(err.message === 'EOF' ? 'Mensagem truncada' : err.message);
  }
  return JSON.parse(body.toString('utf8'));
}

function writeMessage(stream, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  stream.write(Buffer.concat([header, body]));
}

// ---------- validação ----------

// Devolve uma mensagem de erro, ou null se a URL é aceita.
function validateUrl(raw) {
  if (typeof raw !== 'string') return 'URL ausente';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'URL inválida';
  }
  if (url.protocol !== 'https:') return 'A URL precisa usar https';
  if (!ALLOWED_HOSTS.has(url.hostname)) return 'Host não permitido: ' + url.hostname;
  return null;
}

// Aceita "90", "1:30" ou "1:02:03" (decimais só nos segundos). Devolve segundos,
// null se o campo está vazio/ausente, ou NaN se o formato é inválido.
function parseTime(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  if (text === '') return null;
  const parts = text.split(':');
  if (parts.length > 3 || !parts.every((p, i) => (i === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p))) return NaN;
  if (parts.slice(1).some((p) => Number(p) >= 60)) return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

// ---------- yt-dlp ----------

function which(name, env = process.env) {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* não existe nesse diretório */ }
    }
  }
  return null;
}

function defaultOutDir() {
  return path.join(process.env.USERPROFILE || os.homedir(), 'Downloads', 'YouTube');
}

// Sem h264, prefere o melhor vídeo em contêiner mp4 (pode ser AV1/VP9). Com h264,
// tenta avc1 primeiro e cai para o seletor normal se o vídeo não tiver.
function videoFormat(quality, h264) {
  const h = quality === 'best' ? '' : `[height<=${quality}]`;
  const video = h264 ? 'bv*[vcodec^=avc1]' : 'bv*[ext=mp4]';
  return `${video}${h}+ba[ext=m4a]/b[ext=mp4]${h}/bv*${h}+ba/b${h}`;
}

function modeArgs(mode, quality, h264) {
  if (mode === 'video') return ['-f', videoFormat(quality, h264), '--merge-output-format', 'mp4'];
  return ['-x', '--audio-format', 'mp3', '--audio-quality', quality === 'best' ? '0' : quality + 'K'];
}

// 90 -> "1m30s", 3723 -> "1h02m03s". Sem ":" para ser nome de arquivo válido no Windows.
function formatSeconds(total) {
  const t = Math.round(total);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h) return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
  if (m) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// O nome muda com trecho/SponsorBlock para não ser confundido com (e pulado como) o vídeo inteiro.
function outputTemplate({ start = null, end = null, sponsorblock = false } = {}) {
  const tags = [];
  if (start !== null || end !== null) {
    tags.push(`trecho ${formatSeconds(start ?? 0)}-${end !== null ? formatSeconds(end) : 'fim'}`);
  }
  if (sponsorblock) tags.push('sem patrocínio');
  const suffix = tags.length ? ` (${tags.join(', ')})` : '';
  return `%(title).150B [%(id)s]${suffix}.%(ext)s`;
}

function extraArgs({ start = null, end = null, sponsorblock = false }) {
  const args = [];
  if (start !== null || end !== null) {
    args.push('--download-sections', `*${start ?? 0}-${end ?? 'inf'}`, '--force-keyframes-at-cuts');
  }
  if (sponsorblock) args.push('--sponsorblock-remove', SPONSORBLOCK_CATEGORIES);
  return args;
}

function buildArgs(mode, url, outDir, options = {}) {
  const { quality = DEFAULT_QUALITY, h264 = false } = options;
  return [
    '-P', outDir, ...HEAD_ARGS,
    '-o', outputTemplate(options),
    ...TAIL_ARGS,
    ...modeArgs(mode, quality, h264),
    ...extraArgs(options),
    '--', url,
  ];
}

function lastLine(text) {
  return text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith(DL_PREFIX) && !l.startsWith(PP_PREFIX)).pop() || '';
}

const num = (v) => (v && v !== 'NA' && Number.isFinite(Number(v)) ? Number(v) : null);

// Converte uma linha do yt-dlp em {type:'progress', stage, percent, speed, eta}, ou null.
function parseProgress(line) {
  if (line.startsWith(DL_PREFIX)) {
    const [done, total, estimate, speed, eta, vcodec] = line.slice(DL_PREFIX.length).split('|');
    const size = num(total) ?? num(estimate);
    return {
      type: 'progress',
      stage: vcodec === 'none' ? 'audio' : 'video',
      percent: size && num(done) !== null ? Math.min(100, (num(done) / size) * 100) : null,
      speed: num(speed),
      eta: num(eta),
    };
  }
  if (line.startsWith(PP_PREFIX)) {
    const [name, state] = line.slice(PP_PREFIX.length).split('|');
    if (state !== 'started') return null;
    const stages = { Merger: 'merge', ExtractAudio: 'convert', SponsorBlock: 'sponsor', ModifyChapters: 'cut' };
    if (stages[name]) return { type: 'progress', stage: stages[name], percent: null };
  }
  return null;
}

// Junta pedaços de stream em linhas completas.
function lineReader(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(onLine);
  };
}

const childOptions = (timeout) => ({
  shell: false,
  windowsHide: true, // equivalente ao CREATE_NO_WINDOW
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
});

// Uma execução do yt-dlp. `exited: true` marca falha em que o yt-dlp rodou e saiu com erro.
function runOnce({ mode, url, ...options }, deps) {
  const spawnFn = deps.spawn || spawn;
  const whichFn = deps.which || which;
  const outDir = deps.outDir || defaultOutDir();
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
  const throttleMs = deps.throttleMs ?? 250;

  const ytdlp = whichFn('yt-dlp');
  if (!ytdlp) return Promise.resolve({ ok: false, error: 'yt-dlp não encontrado no PATH' });
  if (!whichFn('ffmpeg')) return Promise.resolve({ ok: false, error: 'ffmpeg não encontrado no PATH' });

  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawnFn(ytdlp, buildArgs(mode, url, outDir, options), childOptions(timeoutMs));
    } catch (e) {
      resolve({ ok: false, error: 'Falha ao iniciar o yt-dlp: ' + e.message });
      return;
    }
    let lastStage = null;
    let lastSent = 0;
    const onLine = (line) => {
      const p = parseProgress(line.trim());
      if (!p || !deps.onProgress) return;
      const now = Date.now();
      if (p.stage === lastStage && p.percent !== 100 && now - lastSent < throttleMs) return;
      lastStage = p.stage;
      lastSent = now;
      deps.onProgress(p);
    };
    const readOut = lineReader(onLine);
    const readErr = lineReader(onLine);
    child.stdout.on('data', (d) => { out += d; readOut(String(d)); });
    child.stderr.on('data', (d) => { err += d; readErr(String(d)); });
    child.on('error', (e) => resolve({ ok: false, error: 'Falha ao iniciar o yt-dlp: ' + e.message }));
    child.on('close', (code, signal) => {
      if (signal) return resolve({ ok: false, error: 'Tempo limite excedido (1h)' });
      if (code !== 0) {
        return resolve({ ok: false, error: lastLine(err) || 'yt-dlp terminou com código ' + code, exited: true });
      }
      const file = lastLine(out);
      if (!file) return resolve({ ok: false, error: 'yt-dlp não informou o arquivo final' });
      resolve({ ok: true, file });
    });
  });
}

// ---------- atualização automática do yt-dlp ----------

function updateStatePath() {
  return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'yt-downloader', 'last-update');
}

function canUpdate(statePath, now = Date.now()) {
  try {
    return now - fs.statSync(statePath).mtimeMs > UPDATE_INTERVAL_MS;
  } catch {
    return true; // nunca atualizou
  }
}

function markUpdated(statePath) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, String(Date.now()));
  } catch { /* sem permissão: só perde o limite de frequência */ }
}

// Roda `yt-dlp -U`. Resolve true se terminou com sucesso.
function runYtDlpUpdate(deps) {
  const spawnFn = deps.spawn || spawn;
  const ytdlp = (deps.which || which)('yt-dlp');
  if (!ytdlp) return Promise.resolve(false);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(ytdlp, ['-U'], childOptions(UPDATE_TIMEOUT_MS));
    } catch {
      resolve(false);
      return;
    }
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    child.on('error', () => resolve(false));
    child.on('close', (code, signal) => resolve(code === 0 && !signal));
  });
}

// Baixa; se o yt-dlp falhar por algo que parece desatualização, atualiza (no máximo a cada 6h) e tenta de novo.
async function runDownload(params, deps = {}) {
  const { exited, ...first } = await runOnce(params, deps);
  if (first.ok || !exited || deps.autoUpdate === false || PERMANENT_ERROR.test(first.error)) return first;

  const statePath = deps.updateStatePath || updateStatePath();
  if (!(deps.canUpdate || canUpdate)(statePath)) return first;

  deps.onProgress?.({ type: 'progress', stage: 'update', percent: null });
  const updated = await runYtDlpUpdate(deps);
  (deps.markUpdated || markUpdated)(statePath); // marca mesmo se falhar, para não repetir a cada clique
  if (!updated) return { ok: false, error: first.error + ' (tentei atualizar o yt-dlp, sem sucesso)' };

  deps.onProgress?.({ type: 'progress', stage: 'retry', percent: null });
  const { exited: _exited, ...second } = await runOnce(params, deps);
  return second;
}

// ---------- abrir pasta / arquivo ----------

function handleOpen(msg, deps = {}) {
  const outDir = deps.outDir || defaultOutDir();
  const spawnFn = deps.spawn || spawn;
  let args;
  if (msg.target === 'folder') {
    try { (deps.mkdir || fs.mkdirSync)(outDir, { recursive: true }); } catch { /* o Explorer mostra o erro */ }
    args = [outDir];
  } else if (msg.target === 'file') {
    if (typeof msg.file !== 'string' || msg.file === '') return { ok: false, error: 'Arquivo ausente' };
    const resolved = path.resolve(msg.file);
    const rel = path.relative(outDir, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, error: 'Arquivo fora da pasta de downloads' };
    }
    if (!(deps.exists || fs.existsSync)(resolved)) return { ok: false, error: 'Arquivo não encontrado' };
    args = ['/select,' + resolved];
  } else {
    return { ok: false, error: 'Alvo inválido (use folder ou file)' };
  }
  try {
    const child = spawnFn('explorer.exe', args, { shell: false, detached: true, stdio: 'ignore' });
    child.on?.('error', () => {});
    child.unref?.();
  } catch (e) {
    return { ok: false, error: 'Falha ao abrir o Explorer: ' + e.message };
  }
  return { ok: true };
}

// ---------- mensagens ----------

async function handleMessage(msg, deps) {
  if (msg?.type === 'open') return handleOpen(msg, deps);
  if (!msg || msg.type !== 'download') return { ok: false, error: 'Mensagem desconhecida' };
  if (msg.mode !== 'video' && msg.mode !== 'audio') return { ok: false, error: 'Modo inválido (use video ou audio)' };
  const urlError = validateUrl(msg.url);
  if (urlError) return { ok: false, error: urlError };
  const quality = msg.quality === undefined ? DEFAULT_QUALITY : msg.quality;
  const allowed = msg.mode === 'video' ? VIDEO_QUALITIES : AUDIO_QUALITIES;
  if (!allowed.includes(quality)) return { ok: false, error: 'Qualidade inválida: ' + String(quality) };
  if (msg.h264 !== undefined && typeof msg.h264 !== 'boolean') return { ok: false, error: 'Opção h264 inválida' };
  if (msg.sponsorblock !== undefined && typeof msg.sponsorblock !== 'boolean') {
    return { ok: false, error: 'Opção sponsorblock inválida' };
  }
  const start = parseTime(msg.start);
  const end = parseTime(msg.end);
  if (Number.isNaN(start)) return { ok: false, error: 'Início inválido (use 90, 1:30 ou 1:02:03)' };
  if (Number.isNaN(end)) return { ok: false, error: 'Fim inválido (use 90, 1:30 ou 1:02:03)' };
  if (start !== null && end !== null && end <= start) return { ok: false, error: 'O fim precisa ser maior que o início' };
  return runDownload({
    mode: msg.mode,
    url: msg.url,
    quality,
    h264: msg.mode === 'video' && msg.h264 === true,
    start,
    end,
    sponsorblock: msg.sponsorblock === true,
  }, deps);
}

async function main() {
  for (;;) {
    let msg;
    try {
      msg = await readMessage(process.stdin);
    } catch (e) {
      writeMessage(process.stdout, { ok: false, error: 'Mensagem ilegível: ' + e.message });
      return;
    }
    if (msg === null) return; // Chrome fechou a porta
    const onProgress = (p) => writeMessage(process.stdout, p);
    writeMessage(process.stdout, await handleMessage(msg, { onProgress }));
  }
}

module.exports = {
  readMessage, writeMessage, validateUrl, which, buildArgs, runDownload, handleMessage,
  VIDEO_QUALITIES, AUDIO_QUALITIES, parseProgress, parseTime, outputTemplate, handleOpen, canUpdate,
};

if (require.main === module) main();
