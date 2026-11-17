'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const {
  buildArgs, runDownload, handleMessage, parseProgress, parseTime, outputTemplate, handleOpen,
} = require('../host.js');

const URL_OK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const OUT = 'C:\\out';
const bothTools = (name) => 'C:\\bin\\' + name + '.exe';

// spawn que responde conforme uma lista de passos, um por chamada.
function seqSpawn(steps) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const step = steps[calls.length - 1] || { code: 0 };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (step.stdout) child.stdout.emit('data', step.stdout);
      if (step.stderr) child.stderr.emit('data', step.stderr);
      child.emit('close', step.code ?? 0, null);
    });
    return child;
  };
  fn.calls = calls;
  return fn;
}

// ---------- tempo ----------

test('parseTime: formatos válidos', () => {
  assert.strictEqual(parseTime('90'), 90);
  assert.strictEqual(parseTime('1:30'), 90);
  assert.strictEqual(parseTime('01:02:03'), 3723);
  assert.strictEqual(parseTime('0:05.5'), 5.5);
  assert.strictEqual(parseTime(' 2:00 '), 120);
  assert.strictEqual(parseTime(45), 45);
});

test('parseTime: vazio vira null, inválido vira NaN', () => {
  for (const v of [undefined, null, '', '   ']) assert.strictEqual(parseTime(v), null);
  for (const v of ['abc', '1:60', '1:2:3:4', '-5', '1.5:30', '1:30s', '--', {}, [], -1, Infinity, NaN, '1:-3']) {
    assert.ok(Number.isNaN(parseTime(v)), String(v));
  }
});

// ---------- nome e argumentos ----------

test('outputTemplate: sem opções fica como antes', () => {
  assert.strictEqual(outputTemplate(), '%(title).150B [%(id)s].%(ext)s');
});

test('outputTemplate: trecho e sponsorblock mudam o nome', () => {
  assert.strictEqual(outputTemplate({ start: 90, end: 120 }), '%(title).150B [%(id)s] (trecho 1m30s-2m00s).%(ext)s');
  assert.strictEqual(outputTemplate({ start: 3723 }), '%(title).150B [%(id)s] (trecho 1h02m03s-fim).%(ext)s');
  assert.strictEqual(outputTemplate({ end: 10 }), '%(title).150B [%(id)s] (trecho 0s-10s).%(ext)s');
  assert.strictEqual(outputTemplate({ sponsorblock: true }), '%(title).150B [%(id)s] (sem patrocínio).%(ext)s');
  assert.strictEqual(
    outputTemplate({ start: 5, end: 9, sponsorblock: true }),
    '%(title).150B [%(id)s] (trecho 5s-9s, sem patrocínio).%(ext)s',
  );
});

test('buildArgs: trecho', () => {
  const args = buildArgs('video', URL_OK, OUT, { start: 10, end: 14 });
  assert.deepStrictEqual(args.slice(-5), ['--download-sections', '*10-14', '--force-keyframes-at-cuts', '--', URL_OK]);
  assert.ok(args.includes('%(title).150B [%(id)s] (trecho 10s-14s).%(ext)s'));
});

test('buildArgs: só início vai até o fim, só fim começa do zero', () => {
  assert.ok(buildArgs('audio', URL_OK, OUT, { start: 570 }).includes('*570-inf'));
  assert.ok(buildArgs('audio', URL_OK, OUT, { end: 30 }).includes('*0-30'));
});

test('buildArgs: sponsorblock', () => {
  const args = buildArgs('video', URL_OK, OUT, { sponsorblock: true });
  assert.deepStrictEqual(args.slice(-4), ['--sponsorblock-remove', 'sponsor,selfpromo,interaction', '--', URL_OK]);
  assert.ok(!args.includes('--download-sections'));
});

test('buildArgs: força UTF-8 na saída (caminho com acento não pode virar U+FFFD)', () => {
  const args = buildArgs('video', URL_OK, OUT);
  assert.strictEqual(args[args.indexOf('--encoding') + 1], 'utf-8');
  assert.ok(args.indexOf('--encoding') < args.indexOf('--'));
});

test('runDownload: devolve o caminho final com acentos intacto', async () => {
  const file = 'C:\\out\\Vídeo ação [x] (sem patrocínio).mp4';
  const spawn = seqSpawn([{ stdout: 'YTDLP_DL|1|2|NA|NA|NA|avc1\n' + file + '\n' }]);
  const res = await runDownload({ mode: 'video', url: URL_OK }, { spawn, which: bothTools, outDir: OUT });
  assert.deepStrictEqual(res, { ok: true, file });
});

test('buildArgs: sem opções extras não adiciona flags', () => {
  const args = buildArgs('video', URL_OK, OUT);
  for (const flag of ['--download-sections', '--force-keyframes-at-cuts', '--sponsorblock-remove']) {
    assert.ok(!args.includes(flag), flag);
  }
});

// ---------- validação ----------

test('handleMessage: valida trecho e sponsorblock sem chamar o yt-dlp', async () => {
  const spawn = seqSpawn([]);
  const deps = { spawn, which: bothTools, outDir: OUT };
  const base = { type: 'download', url: URL_OK, mode: 'video' };
  for (const extra of [
    { start: 'abc' }, { end: '1:99' }, { start: '2:00', end: '1:00' }, { start: '1:00', end: '1:00' },
    { sponsorblock: 'sim' }, { start: {} },
  ]) {
    const res = await handleMessage({ ...base, ...extra }, deps);
    assert.strictEqual(res.ok, false, JSON.stringify(extra));
  }
  assert.strictEqual(spawn.calls.length, 0);
});

test('handleMessage: trecho e sponsorblock chegam ao yt-dlp', async () => {
  const spawn = seqSpawn([{ stdout: 'C:\\out\\v.mp4\n' }]);
  await handleMessage(
    { type: 'download', url: URL_OK, mode: 'audio', start: '1:30', end: '2:00', sponsorblock: true },
    { spawn, which: bothTools, outDir: OUT },
  );
  const args = spawn.calls[0].args;
  assert.ok(args.includes('*90-120'));
  assert.ok(args.includes('--sponsorblock-remove'));
});

test('handleMessage: campos de trecho vazios equivalem a vídeo inteiro', async () => {
  const spawn = seqSpawn([{ stdout: 'C:\\out\\v.mp4\n' }]);
  await handleMessage({ type: 'download', url: URL_OK, mode: 'video', start: '', end: '  ' }, { spawn, which: bothTools, outDir: OUT });
  assert.ok(!spawn.calls[0].args.includes('--download-sections'));
});

// ---------- progresso ----------

test('parseProgress: estágios do SponsorBlock', () => {
  assert.deepStrictEqual(parseProgress('YTDLP_PP|SponsorBlock|started'), { type: 'progress', stage: 'sponsor', percent: null });
  assert.deepStrictEqual(parseProgress('YTDLP_PP|ModifyChapters|started'), { type: 'progress', stage: 'cut', percent: null });
  assert.strictEqual(parseProgress('YTDLP_PP|SponsorBlock|finished'), null);
});

// ---------- atualização automática ----------

const failExtract = { code: 1, stderr: 'ERROR: [youtube] abc: Unable to extract player response\n' };

function updateDeps(spawn, extra = {}) {
  const state = { marked: 0, events: [] };
  return {
    state,
    deps: {
      spawn, which: bothTools, outDir: OUT, throttleMs: 0,
      updateStatePath: 'C:\\state\\last-update',
      canUpdate: () => true,
      markUpdated: () => { state.marked++; },
      onProgress: (p) => state.events.push(p.stage),
      ...extra,
    },
  };
}

test('atualização: falha de extração atualiza o yt-dlp e tenta de novo', async () => {
  const spawn = seqSpawn([failExtract, { code: 0 }, { stdout: 'C:\\out\\v.mp4\n' }]);
  const { deps, state } = updateDeps(spawn);
  const res = await runDownload({ mode: 'video', url: URL_OK }, deps);
  assert.deepStrictEqual(res, { ok: true, file: 'C:\\out\\v.mp4' });
  assert.strictEqual(spawn.calls.length, 3);
  assert.deepStrictEqual(spawn.calls[1].args, ['-U']);
  assert.strictEqual(spawn.calls[1].opts.shell, false);
  assert.strictEqual(spawn.calls[1].opts.windowsHide, true);
  assert.strictEqual(state.marked, 1);
  assert.deepStrictEqual(state.events, ['update', 'retry']);
});

test('atualização: o resultado público não vaza o campo interno exited', async () => {
  const spawn = seqSpawn([failExtract, { code: 0 }, { code: 1, stderr: 'ERROR: HTTP Error 403: Forbidden\n' }]);
  const { deps } = updateDeps(spawn);
  const res = await runDownload({ mode: 'video', url: URL_OK }, deps);
  assert.deepStrictEqual(res, { ok: false, error: 'ERROR: HTTP Error 403: Forbidden' });
});

test('atualização: falha ao atualizar devolve o erro original com aviso', async () => {
  const spawn = seqSpawn([failExtract, { code: 1 }]);
  const { deps, state } = updateDeps(spawn);
  const res = await runDownload({ mode: 'video', url: URL_OK }, deps);
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /Unable to extract player response/);
  assert.match(res.error, /tentei atualizar o yt-dlp/);
  assert.strictEqual(spawn.calls.length, 2);
  assert.strictEqual(state.marked, 1);
});

test('atualização: erro permanente (indisponível/privado) não atualiza', async () => {
  for (const msg of ['ERROR: Video unavailable', 'ERROR: Private video. Sign in', 'ERROR: members-only content']) {
    const spawn = seqSpawn([{ code: 1, stderr: msg + '\n' }]);
    const { deps } = updateDeps(spawn);
    const res = await runDownload({ mode: 'video', url: URL_OK }, deps);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(spawn.calls.length, 1, msg);
  }
});

test('atualização: respeita o limite de frequência', async () => {
  const spawn = seqSpawn([failExtract]);
  const { deps } = updateDeps(spawn, { canUpdate: () => false });
  const res = await runDownload({ mode: 'video', url: URL_OK }, deps);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(spawn.calls.length, 1);
  assert.ok(!res.error.includes('tentei atualizar'));
});

test('atualização: autoUpdate false desliga', async () => {
  const spawn = seqSpawn([failExtract]);
  const { deps } = updateDeps(spawn, { autoUpdate: false });
  await runDownload({ mode: 'video', url: URL_OK }, deps);
  assert.strictEqual(spawn.calls.length, 1);
});

test('atualização: yt-dlp ausente ou timeout não tentam atualizar', async () => {
  const none = seqSpawn([]);
  const a = updateDeps(none, { which: () => null });
  assert.strictEqual((await runDownload({ mode: 'video', url: URL_OK }, a.deps)).ok, false);
  assert.strictEqual(none.calls.length, 0);

  const timeout = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', null, 'SIGTERM'));
    return child;
  };
  const b = updateDeps(timeout);
  const res = await runDownload({ mode: 'video', url: URL_OK }, b.deps);
  assert.match(res.error, /Tempo limite/);
});

test('atualização: sucesso na primeira não atualiza nada', async () => {
  const spawn = seqSpawn([{ stdout: 'C:\\out\\v.mp4\n' }]);
  const { deps, state } = updateDeps(spawn);
  const res = await runDownload({ mode: 'video', url: URL_OK }, deps);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(spawn.calls.length, 1);
  assert.strictEqual(state.marked, 0);
});

// ---------- abrir pasta e arquivo ----------

function openSpawn() {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  };
  fn.calls = calls;
  return fn;
}

test('open: pasta abre o Explorer na pasta de downloads', () => {
  const spawn = openSpawn();
  const res = handleOpen({ type: 'open', target: 'folder' }, { spawn, outDir: OUT, mkdir: () => {} });
  assert.deepStrictEqual(res, { ok: true });
  assert.deepStrictEqual(spawn.calls[0].args, [OUT]);
  assert.strictEqual(spawn.calls[0].cmd, 'explorer.exe');
  assert.strictEqual(spawn.calls[0].opts.shell, false);
});

test('open: arquivo dentro da pasta usa /select,', () => {
  const spawn = openSpawn();
  const file = path.join(OUT, 'Video [x].mp4');
  const res = handleOpen({ type: 'open', target: 'file', file }, { spawn, outDir: OUT, exists: () => true });
  assert.deepStrictEqual(res, { ok: true });
  assert.deepStrictEqual(spawn.calls[0].args, ['/select,' + file]);
});

test('open: recusa arquivo fora da pasta de downloads', () => {
  const spawn = openSpawn();
  const deps = { spawn, outDir: OUT, exists: () => true };
  for (const file of [
    'C:\\Windows\\System32\\cmd.exe', 'C:\\outside\\v.mp4', 'C:\\out\\..\\secret.txt',
    'C:\\out', 'C:\\out2\\v.mp4', '..\\v.mp4', 'D:\\out\\v.mp4',
  ]) {
    const res = handleOpen({ type: 'open', target: 'file', file }, deps);
    assert.strictEqual(res.ok, false, file);
  }
  assert.strictEqual(spawn.calls.length, 0);
});

test('open: arquivo inexistente, ausente e alvo inválido', () => {
  const spawn = openSpawn();
  const deps = { spawn, outDir: OUT, exists: () => false };
  assert.strictEqual(handleOpen({ type: 'open', target: 'file', file: 'C:\\out\\x.mp4' }, deps).ok, false);
  assert.strictEqual(handleOpen({ type: 'open', target: 'file' }, deps).ok, false);
  assert.strictEqual(handleOpen({ type: 'open', target: 'file', file: 42 }, deps).ok, false);
  assert.strictEqual(handleOpen({ type: 'open', target: 'cmd' }, deps).ok, false);
  assert.strictEqual(spawn.calls.length, 0);
});

test('handleMessage: roteia type open', async () => {
  const spawn = openSpawn();
  const res = await handleMessage({ type: 'open', target: 'folder' }, { spawn, outDir: OUT, mkdir: () => {} });
  assert.deepStrictEqual(res, { ok: true });
});
