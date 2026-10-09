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

// Linhas de progresso do yt-dlp, com prefixo para distinguir do caminho final do arquivo.
const DL_PREFIX = 'YTDLP_DL|';
const PP_PREFIX = 'YTDLP_PP|';
const DL_FIELDS = ['downloaded_bytes', 'total_bytes', 'total_bytes_estimate', 'speed', 'eta']
  .map((f) => '%(progress.' + f + ')s').concat('%(info.vcodec)s').join('|');

const COMMON_ARGS = [
  '--no-playlist',
  '--windows-filenames',
  '--embed-metadata',
  '-o', '%(title).150B [%(id)s].%(ext)s',
  '--print', 'after_move:filepath',
  '--newline', '--progress',
  '--progress-template', 'download:' + DL_PREFIX + DL_FIELDS,
  '--progress-template', 'postprocess:' + PP_PREFIX + '%(progress.postprocessor)s|%(progress.status)s',
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

function buildArgs(mode, url, outDir, { quality = DEFAULT_QUALITY, h264 = false } = {}) {
  return ['-P', outDir, ...COMMON_ARGS, ...modeArgs(mode, quality, h264), '--', url];
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
    if (name === 'Merger') return { type: 'progress', stage: 'merge', percent: null };
    if (name === 'ExtractAudio') return { type: 'progress', stage: 'convert', percent: null };
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

function runDownload({ mode, url, quality, h264 }, deps = {}) {
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
      child = spawnFn(ytdlp, buildArgs(mode, url, outDir, { quality, h264 }), {
        shell: false,
        windowsHide: true, // equivalente ao CREATE_NO_WINDOW
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
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
      if (code !== 0) return resolve({ ok: false, error: lastLine(err) || 'yt-dlp terminou com código ' + code });
      const file = lastLine(out);
      if (!file) return resolve({ ok: false, error: 'yt-dlp não informou o arquivo final' });
      resolve({ ok: true, file });
    });
  });
}

async function handleMessage(msg, deps) {
  if (!msg || msg.type !== 'download') return { ok: false, error: 'Mensagem desconhecida' };
  if (msg.mode !== 'video' && msg.mode !== 'audio') return { ok: false, error: 'Modo inválido (use video ou audio)' };
  const urlError = validateUrl(msg.url);
  if (urlError) return { ok: false, error: urlError };
  const quality = msg.quality === undefined ? DEFAULT_QUALITY : msg.quality;
  const allowed = msg.mode === 'video' ? VIDEO_QUALITIES : AUDIO_QUALITIES;
  if (!allowed.includes(quality)) return { ok: false, error: 'Qualidade inválida: ' + String(quality) };
  if (msg.h264 !== undefined && typeof msg.h264 !== 'boolean') return { ok: false, error: 'Opção h264 inválida' };
  return runDownload({ mode: msg.mode, url: msg.url, quality, h264: msg.mode === 'video' && msg.h264 === true }, deps);
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
  VIDEO_QUALITIES, AUDIO_QUALITIES, parseProgress,
};

if (require.main === module) main();
