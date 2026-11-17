'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const sponsor = require('../extension/sponsor.js');

const ID = 'dQw4w9WgXcQ';
const seg = (category, start, end, actionType = 'skip') => ({ category, actionType, segment: [start, end] });

test('hashPrefix: 4 caracteres hex do SHA-256 do ID', async () => {
  const expected = crypto.createHash('sha256').update(ID).digest('hex').slice(0, 4);
  assert.strictEqual(await sponsor.hashPrefix(ID), expected);
  assert.match(await sponsor.hashPrefix(ID), /^[0-9a-f]{4}$/);
});

test('buildUrl: parâmetros repetidos e só o prefixo (nunca o ID)', () => {
  const url = sponsor.buildUrl('5f6b');
  assert.strictEqual(
    url,
    'https://sponsor.ajay.app/api/skipSegments/5f6b?category=sponsor&category=selfpromo&category=interaction&actionType=skip',
  );
  assert.ok(!url.includes(ID));
});

test('parseSegments: escolhe o vídeo certo e ordena', () => {
  const list = [
    { videoID: 'outroVideo01', segments: [seg('sponsor', 1, 2)] },
    { videoID: ID, segments: [seg('selfpromo', 50, 60), seg('sponsor', 10, 20)] },
  ];
  assert.deepStrictEqual(sponsor.parseSegments(list, ID), [[10, 20], [50, 60]]);
});

test('parseSegments: une sobreposições e trechos colados', () => {
  const list = [{ videoID: ID, segments: [seg('sponsor', 10, 20), seg('selfpromo', 15, 30), seg('interaction', 30, 35)] }];
  assert.deepStrictEqual(sponsor.parseSegments(list, ID), [[10, 35]]);
});

test('parseSegments: descarta categorias, ações e trechos inválidos', () => {
  const list = [{
    videoID: ID,
    segments: [
      seg('music_offtopic', 1, 5), seg('sponsor', 6, 9, 'mute'), seg('sponsor', 9, 9),
      seg('sponsor', 20, 10), seg('sponsor', -5, 3), { category: 'sponsor', actionType: 'skip', segment: ['a', 'b'] },
      { category: 'sponsor', actionType: 'skip' }, null, seg('sponsor', 100, 110),
    ],
  }];
  assert.deepStrictEqual(sponsor.parseSegments(list, ID), [[100, 110]]);
});

test('parseSegments: resposta inesperada vira lista vazia', () => {
  for (const v of [null, undefined, {}, 'x', 5, [], [{}], [{ videoID: ID }], [{ videoID: ID, segments: 'x' }]]) {
    assert.deepStrictEqual(sponsor.parseSegments(v, ID), []);
  }
});

test('findSkip: pula só quando está dentro do trecho', () => {
  const segments = [[10, 20], [50, 60]];
  assert.strictEqual(sponsor.findSkip(segments, 5), null);
  assert.strictEqual(sponsor.findSkip(segments, 10), 20);
  assert.strictEqual(sponsor.findSkip(segments, 9.97), 20); // pouco antes do início
  assert.strictEqual(sponsor.findSkip(segments, 15), 20);
  assert.strictEqual(sponsor.findSkip(segments, 19.9), null); // já no fim: não vale pular
  assert.strictEqual(sponsor.findSkip(segments, 20), null);
  assert.strictEqual(sponsor.findSkip(segments, 55), 60);
  assert.strictEqual(sponsor.findSkip([], 10), null);
});

test('fetchSegments: monta a consulta e devolve os trechos', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => [{ videoID: ID, segments: [seg('sponsor', 5, 12)] }] };
  };
  assert.deepStrictEqual(await sponsor.fetchSegments(ID, fetchFn), [[5, 12]]);
  assert.strictEqual(urls.length, 1);
  assert.ok(!urls[0].includes(ID));
  assert.match(urls[0], /skipSegments\/[0-9a-f]{4}\?/);
});

test('fetchSegments: 404 é "sem trechos", outros erros lançam', async () => {
  assert.deepStrictEqual(await sponsor.fetchSegments(ID, async () => ({ ok: false, status: 404 })), []);
  await assert.rejects(sponsor.fetchSegments(ID, async () => ({ ok: false, status: 500 })), /500/);
});

test('fetchSegments: recusa ID inválido sem fazer requisição', async () => {
  let called = 0;
  const fetchFn = async () => { called++; return { ok: true, status: 200, json: async () => [] }; };
  for (const bad of ['', 'curto', 'muito_longo_demais', 'abc/../def12', undefined, null, 'a b c d e f g']) {
    await assert.rejects(sponsor.fetchSegments(bad, fetchFn), /inválido/);
  }
  assert.strictEqual(called, 0);
});
