'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  readMessage, writeMessage, validateUrl, which, buildArgs, runDownload, handleMessage, parseProgress,
} = require('../host.js');
const { extensionId } = require('../install.js');

const URL_OK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const OUT = 'C:\\out';
const PROGRESS_ARGS = [
  '--newline', '--progress',
  '--progress-template',
  'download:YTDLP_DL|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.vcodec)s',
  '--progress-template', 'postprocess:YTDLP_PP|%(progress.postprocessor)s|%(progress.status)s',
];

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

// spawn falso: registra a chamada e emite stdout/stderr/close
function fakeSpawn({ stdout = '', stderr = '', code = 0, signal = null, spawnError = null } = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (spawnError) return child.emit('error', spawnError);
      if (stdout) child.stdout.emit('data', stdout);
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', code, signal);
    });
    return child;
  };
  fn.calls = calls;
  return fn;
}
const bothTools = (name) => 'C:\\bin\\' + name + '.exe';

// ---------- protocolo ----------

test('protocolo: ida e volta', async () => {
  const input = new PassThrough();
  input.end(frame({ type: 'download', texto: 'ação ✓' }));
  assert.deepStrictEqual(await readMessage(input), { type: 'download', texto: 'ação ✓' });
  assert.strictEqual(await readMessage(input), null); // EOF limpo
});

test('protocolo: duas mensagens seguidas', async () => {
  const input = new PassThrough();
  input.end(Buffer.concat([frame({ n: 1 }), frame({ n: 2 })]));
  assert.deepStrictEqual(await readMessage(input), { n: 1 });
  assert.deepStrictEqual(await readMessage(input), { n: 2 });
  assert.strictEqual(await readMessage(input), null);
});

test('protocolo: writeMessage usa 4 bytes little-endian + UTF-8', () => {
  const out = new PassThrough();
  writeMessage(out, { ok: true, file: 'á' });
  const buf = out.read();
  const body = Buffer.from('{"ok":true,"file":"á"}', 'utf8');
  assert.strictEqual(buf.readUInt32LE(0), body.length);
  assert.deepStrictEqual(buf.subarray(4), body);
});

test('protocolo: corpo truncado dá erro', async () => {
  const input = new PassThrough();
  input.end(frame({ a: 'abcdefgh' }).subarray(0, 8));
  await assert.rejects(readMessage(input), /truncada/);
});

test('protocolo: cabeçalho truncado dá erro', async () => {
  const input = new PassThrough();
  input.end(Buffer.from([1, 0]));
  await assert.rejects(readMessage(input), /truncada/);
});

test('protocolo: tamanho absurdo é recusado', async () => {
  const input = new PassThrough();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(0xffffffff, 0);
  input.end(header);
  await assert.rejects(readMessage(input), /grande demais/);
});

test('protocolo: JSON inválido dá erro', async () => {
  const input = new PassThrough();
  const body = Buffer.from('{nao eh json');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  input.end(Buffer.concat([header, body]));
  await assert.rejects(readMessage(input), SyntaxError);
});

// ---------- validação de URL ----------

test('URL: aceita hosts do YouTube', () => {
  for (const u of [
    'https://youtube.com/watch?v=x', 'https://www.youtube.com/watch?v=x',
    'https://m.youtube.com/watch?v=x', 'https://music.youtube.com/watch?v=x',
    'https://youtu.be/x',
  ]) assert.strictEqual(validateUrl(u), null, u);
});

test('URL: recusa o que não é YouTube https', () => {
  for (const u of [
    'http://www.youtube.com/watch?v=x', 'https://youtube.com.evil.com/watch?v=x',
    'https://evil.com/?u=youtube.com', 'https://www.youtube.com@evil.com/',
    'https://evilyoutube.com/', 'javascript:alert(1)', 'file:///C:/x', 'nao-e-url', '',
  ]) assert.notStrictEqual(validateUrl(u), null, u);
  assert.notStrictEqual(validateUrl(undefined), null);
  assert.notStrictEqual(validateUrl(42), null);
});

// ---------- comandos ----------

test('buildArgs: MP4', () => {
  assert.deepStrictEqual(buildArgs('video', URL_OK, OUT), [
    '-P', OUT, '--no-playlist', '--windows-filenames', '--embed-metadata',
    '-o', '%(title).150B [%(id)s].%(ext)s', '--print', 'after_move:filepath',
    ...PROGRESS_ARGS,
    '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4',
    '--', URL_OK,
  ]);
});

test('buildArgs: MP3', () => {
  assert.deepStrictEqual(buildArgs('audio', URL_OK, OUT), [
    '-P', OUT, '--no-playlist', '--windows-filenames', '--embed-metadata',
    '-o', '%(title).150B [%(id)s].%(ext)s', '--print', 'after_move:filepath',
    ...PROGRESS_ARGS,
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '--', URL_OK,
  ]);
});

test('runDownload: spawn sem shell, sem janela, sem stdin, URL depois de --', async () => {
  const spawn = fakeSpawn({ stdout: 'C:\\out\\Video [x].mp4\r\n' });
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.deepStrictEqual(res, { ok: true, file: 'C:\\out\\Video [x].mp4' });
  const { cmd, args, opts } = spawn.calls[0];
  assert.strictEqual(cmd, 'C:\\bin\\yt-dlp.exe');
  assert.strictEqual(args.at(-1), URL_OK);
  assert.strictEqual(args.at(-2), '--');
  assert.strictEqual(opts.shell, false);
  assert.strictEqual(opts.windowsHide, true);
  assert.strictEqual(opts.stdio[0], 'ignore');
  assert.strictEqual(opts.timeout, 60 * 60 * 1000);
});

test('runDownload: pega a última linha do stdout como arquivo', async () => {
  const spawn = fakeSpawn({ stdout: 'lixo\nC:\\out\\a.mp3\n' });
  const res = await runDownload({ mode: 'audio', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.strictEqual(res.file, 'C:\\out\\a.mp3');
});

// ---------- erros ----------

test('erro: yt-dlp ausente', async () => {
  const spawn = fakeSpawn();
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: (n) => (n === 'ffmpeg' ? 'x' : null) });
  assert.deepStrictEqual(res, { ok: false, error: 'yt-dlp não encontrado no PATH' });
  assert.strictEqual(spawn.calls.length, 0);
});

test('erro: ffmpeg ausente', async () => {
  const spawn = fakeSpawn();
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: (n) => (n === 'yt-dlp' ? 'x' : null) });
  assert.deepStrictEqual(res, { ok: false, error: 'ffmpeg não encontrado no PATH' });
  assert.strictEqual(spawn.calls.length, 0);
});

test('erro: código diferente de zero devolve a última linha do stderr', async () => {
  const spawn = fakeSpawn({ code: 1, stderr: 'aviso\nERROR: Video unavailable\n' });
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.deepStrictEqual(res, { ok: false, error: 'ERROR: Video unavailable' });
});

test('erro: timeout (processo morto por sinal)', async () => {
  const spawn = fakeSpawn({ code: null, signal: 'SIGTERM' });
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /Tempo limite/);
});

test('erro: falha ao iniciar o processo', async () => {
  const spawn = fakeSpawn({ spawnError: new Error('EACCES') });
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /EACCES/);
});

test('erro: sucesso sem caminho do arquivo', async () => {
  const spawn = fakeSpawn({ stdout: '' });
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.strictEqual(res.ok, false);
});

test('handleMessage: modo/URL/tipo inválidos não chamam o yt-dlp', async () => {
  const spawn = fakeSpawn();
  const deps = { spawn, which: bothTools, outDir: OUT };
  for (const msg of [
    { type: 'download', url: URL_OK, mode: 'gif' },
    { type: 'download', url: URL_OK, mode: '__proto__' },
    { type: 'download', url: 'https://evil.com/x', mode: 'video' },
    { type: 'outra', url: URL_OK, mode: 'video' },
    null,
  ]) {
    const res = await handleMessage(msg, deps);
    assert.strictEqual(res.ok, false);
  }
  assert.strictEqual(spawn.calls.length, 0);
});

test('handleMessage: fluxo feliz', async () => {
  const spawn = fakeSpawn({ stdout: 'C:\\out\\v.mp4\n' });
  const res = await handleMessage({ type: 'download', url: URL_OK, mode: 'video' }, { spawn, which: bothTools, outDir: OUT });
  assert.deepStrictEqual(res, { ok: true, file: 'C:\\out\\v.mp4' });
});

// ---------- which / ID ----------

test('which: encontra .exe no PATH e devolve null se não houver', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'which-'));
  fs.writeFileSync(path.join(dir, 'fake-tool.exe'), '');
  const env = { PATH: dir, PATHEXT: '.EXE' };
  assert.strictEqual(which('fake-tool', env).toLowerCase(), path.join(dir, 'fake-tool.exe').toLowerCase());
  assert.strictEqual(which('nao-existe', env), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extensionId: chave do manifest gera o ID esperado', () => {
  const key = require('../../extension/manifest.json').key;
  assert.strictEqual(extensionId(key), 'fkpfdanjlidaodlcjnhjkhlolaknlede');
});

// ---------- qualidade ----------

test('buildArgs: MP4 com altura máxima', () => {
  const args = buildArgs('video', URL_OK, OUT, { quality: '720' });
  assert.strictEqual(
    args[args.indexOf('-f') + 1],
    'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba/b[height<=720]',
  );
});

test('buildArgs: MP4 preferindo H.264', () => {
  const best = buildArgs('video', URL_OK, OUT, { h264: true });
  assert.strictEqual(
    best[best.indexOf('-f') + 1],
    'bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
  );
  const capped = buildArgs('video', URL_OK, OUT, { quality: '1080', h264: true });
  assert.strictEqual(
    capped[capped.indexOf('-f') + 1],
    'bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b[height<=1080]',
  );
});

test('buildArgs: MP3 com bitrate', () => {
  const args = buildArgs('audio', URL_OK, OUT, { quality: '192' });
  assert.deepStrictEqual(args.slice(-7, -2), ['-x', '--audio-format', 'mp3', '--audio-quality', '192K']);
  const best = buildArgs('audio', URL_OK, OUT, { quality: 'best' });
  assert.strictEqual(best.at(-3), '0');
});

test('handleMessage: repassa qualidade e h264 ao yt-dlp', async () => {
  const spawn = fakeSpawn({ stdout: 'C:\out\v.mp4\n' });
  const deps = { spawn, which: bothTools, outDir: OUT };
  await handleMessage({ type: 'download', url: URL_OK, mode: 'video', quality: '480', h264: true }, deps);
  const args = spawn.calls[0].args;
  assert.match(args[args.indexOf('-f') + 1], /^bv\*\[vcodec\^=avc1\]\[height<=480\]/);
});

test('handleMessage: h264 é ignorado em áudio', async () => {
  const spawn = fakeSpawn({ stdout: 'C:\out\a.mp3\n' });
  const deps = { spawn, which: bothTools, outDir: OUT };
  await handleMessage({ type: 'download', url: URL_OK, mode: 'audio', quality: '128', h264: true }, deps);
  assert.ok(!spawn.calls[0].args.includes('-f'));
  assert.ok(spawn.calls[0].args.includes('128K'));
});

test('handleMessage: qualidade inválida não chama o yt-dlp (inclui injeção)', async () => {
  const spawn = fakeSpawn();
  const deps = { spawn, which: bothTools, outDir: OUT };
  for (const msg of [
    { type: 'download', url: URL_OK, mode: 'video', quality: '999' },
    { type: 'download', url: URL_OK, mode: 'video', quality: '720]/best;calc' },
    { type: 'download', url: URL_OK, mode: 'video', quality: '192' }, // bitrate não vale para vídeo
    { type: 'download', url: URL_OK, mode: 'audio', quality: '1080' }, // altura não vale para áudio
    { type: 'download', url: URL_OK, mode: 'audio', quality: 320 },
    { type: 'download', url: URL_OK, mode: 'video', h264: 'sim' },
  ]) {
    const res = await handleMessage(msg, deps);
    assert.strictEqual(res.ok, false, JSON.stringify(msg));
  }
  assert.strictEqual(spawn.calls.length, 0);
});

// ---------- progresso ----------

test('parseProgress: download com tamanho exato', () => {
  assert.deepStrictEqual(
    parseProgress('YTDLP_DL|500|1000|NA|2048.5|30|avc1.640028'),
    { type: 'progress', stage: 'video', percent: 50, speed: 2048.5, eta: 30 },
  );
});

test('parseProgress: usa o tamanho estimado e identifica áudio', () => {
  const p = parseProgress('YTDLP_DL|250|NA|1000|NA|NA|none');
  assert.strictEqual(p.stage, 'audio');
  assert.strictEqual(p.percent, 25);
  assert.strictEqual(p.speed, null);
  assert.strictEqual(p.eta, null);
});

test('parseProgress: sem tamanho conhecido e limite de 100%', () => {
  assert.strictEqual(parseProgress('YTDLP_DL|500|NA|NA|NA|NA|avc1').percent, null);
  assert.strictEqual(parseProgress('YTDLP_DL|1100|1000|NA|NA|NA|avc1').percent, 100);
});

test('parseProgress: pós-processamento', () => {
  assert.deepStrictEqual(parseProgress('YTDLP_PP|Merger|started'), { type: 'progress', stage: 'merge', percent: null });
  assert.deepStrictEqual(parseProgress('YTDLP_PP|ExtractAudio|started'), { type: 'progress', stage: 'convert', percent: null });
  assert.strictEqual(parseProgress('YTDLP_PP|Merger|finished'), null);
  assert.strictEqual(parseProgress('YTDLP_PP|FFmpegMetadata|started'), null);
});

test('parseProgress: ignora linhas comuns', () => {
  assert.strictEqual(parseProgress('C:\out\video.mp4'), null);
  assert.strictEqual(parseProgress(''), null);
});

test('runDownload: repassa progresso e ignora marcadores ao achar o arquivo', async () => {
  const spawn = fakeSpawn({
    stdout: 'YTDLP_DL|10|100|NA|1000|9|avc1\nYTDLP_DL|100|100|NA|1000|0|avc1\nYTDLP_PP|Merger|started\nC:\out\v.mp4\n',
  });
  const events = [];
  const res = await runDownload(
    { mode: 'video', url: URL_OK },
    { spawn, which: bothTools, outDir: OUT, throttleMs: 0, onProgress: (p) => events.push(p) },
  );
  assert.deepStrictEqual(res, { ok: true, file: 'C:\out\v.mp4' });
  assert.deepStrictEqual(events.map((e) => [e.stage, e.percent]), [['video', 10], ['video', 100], ['merge', null]]);
});

test('runDownload: progresso chega em linhas partidas entre chunks', async () => {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', 'YTDLP_DL|5');
      child.stdout.emit('data', '0|100|NA|NA|NA|avc1\nC:\out\v.mp4\n');
      child.emit('close', 0, null);
    });
    return child;
  };
  const events = [];
  const res = await runDownload(
    { mode: 'video', url: URL_OK },
    { spawn, which: bothTools, outDir: OUT, throttleMs: 0, onProgress: (p) => events.push(p) },
  );
  assert.strictEqual(res.ok, true);
  assert.strictEqual(events[0].percent, 50);
});

test('runDownload: limita a taxa de mensagens de progresso', async () => {
  const lines = Array.from({ length: 50 }, (_, i) => `YTDLP_DL|${i}|100|NA|NA|NA|avc1`).join('\n') + '\nC:\out\v.mp4\n';
  const spawn = fakeSpawn({ stdout: lines });
  const events = [];
  await runDownload(
    { mode: 'video', url: URL_OK },
    { spawn, which: bothTools, outDir: OUT, onProgress: (p) => events.push(p) },
  );
  assert.ok(events.length < 5, 'esperava poucas mensagens, veio ' + events.length);
});

test('runDownload: erro do yt-dlp ignora linhas de progresso no stderr', async () => {
  const spawn = fakeSpawn({ code: 1, stderr: 'YTDLP_DL|1|2|NA|NA|NA|avc1\nERROR: Video unavailable\nYTDLP_DL|1|2|NA|NA|NA|avc1\n' });
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.deepStrictEqual(res, { ok: false, error: 'ERROR: Video unavailable' });
});
