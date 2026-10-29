'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createPruner, install, EVENT_NAME } = require('../extension/adprune.js');

const playerResponse = () => ({
  videoDetails: { videoId: 'abc' },
  streamingData: { formats: [1, 2] },
  adPlacements: [{ x: 1 }],
  playerAds: [{ y: 2 }],
  adSlots: [{ z: 3 }],
});

// window mínimo: JSON, Response, document (EventTarget) e localStorage.
function fakeWindow({ stored = null } = {}) {
  class Response {
    constructor(data) { this.data = data; }
    json() { return Promise.resolve(this.data); }
  }
  return {
    JSON: { parse: JSON.parse.bind(JSON) },
    Response,
    document: new EventTarget(),
    localStorage: { getItem: () => stored },
  };
}

test('prune: remove campos de anúncio e preserva o resto', () => {
  const prune = createPruner(() => true);
  const out = prune(playerResponse());
  assert.deepStrictEqual(out, { videoDetails: { videoId: 'abc' }, streamingData: { formats: [1, 2] } });
});

test('prune: limpa também playerResponse aninhado', () => {
  const prune = createPruner(() => true);
  const out = prune({ playerResponse: playerResponse(), other: 1 });
  assert.deepStrictEqual(out, {
    playerResponse: { videoDetails: { videoId: 'abc' }, streamingData: { formats: [1, 2] } },
    other: 1,
  });
});

test('prune: desligado não toca em nada', () => {
  const prune = createPruner(() => false);
  assert.deepStrictEqual(prune(playerResponse()), playerResponse());
});

test('prune: valores que não são objeto passam direto', () => {
  const prune = createPruner(() => true);
  for (const v of [null, undefined, 1, 'texto', true]) assert.strictEqual(prune(v), v);
});

test('prune: objeto congelado não lança e volta como veio', () => {
  const prune = createPruner(() => true);
  const frozen = Object.freeze(playerResponse());
  assert.doesNotThrow(() => prune(frozen));
  assert.strictEqual(prune(frozen), frozen);
});

test('prune: JSON sem campos de anúncio não muda', () => {
  const prune = createPruner(() => true);
  const data = { a: 1, b: { c: 2 } };
  assert.deepStrictEqual(prune(data), { a: 1, b: { c: 2 } });
});

test('install: JSON.parse devolve resposta sem anúncios', () => {
  const win = fakeWindow();
  install(win);
  const out = win.JSON.parse(JSON.stringify(playerResponse()));
  assert.ok(!('adPlacements' in out) && !('playerAds' in out) && !('adSlots' in out));
  assert.strictEqual(out.videoDetails.videoId, 'abc');
});

test('install: JSON.parse mantém o comportamento normal (valores e erros)', () => {
  const win = fakeWindow();
  install(win);
  assert.strictEqual(win.JSON.parse('5'), 5);
  assert.deepStrictEqual(win.JSON.parse('[1,2]'), [1, 2]);
  assert.throws(() => win.JSON.parse('{ruim'), SyntaxError);
});

test('install: Response.json (fetch) devolve resposta sem anúncios', async () => {
  const win = fakeWindow();
  install(win);
  const out = await new win.Response(playerResponse()).json();
  assert.ok(!('adPlacements' in out));
  assert.deepStrictEqual(out.streamingData, { formats: [1, 2] });
});

test('install: ytInitialPlayerResponse é limpo na atribuição', () => {
  const win = fakeWindow();
  install(win);
  win.ytInitialPlayerResponse = playerResponse();
  assert.ok(!('playerAds' in win.ytInitialPlayerResponse));
  assert.strictEqual(win.ytInitialPlayerResponse.videoDetails.videoId, 'abc');
});

test('install: começa desligado se a chave salva for 0', () => {
  const win = fakeWindow({ stored: '0' });
  install(win);
  const out = win.JSON.parse(JSON.stringify(playerResponse()));
  assert.ok('adPlacements' in out);
});

test('install: evento liga e desliga em tempo real', () => {
  const win = fakeWindow();
  install(win);
  win.document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: false }));
  assert.ok('adPlacements' in win.JSON.parse(JSON.stringify(playerResponse())));
  win.document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: true }));
  assert.ok(!('adPlacements' in win.JSON.parse(JSON.stringify(playerResponse()))));
});

test('install: sem Response ou sem localStorage não quebra', () => {
  const win = { JSON: { parse: JSON.parse.bind(JSON) }, document: new EventTarget() };
  assert.doesNotThrow(() => install(win));
  assert.ok(!('adPlacements' in win.JSON.parse(JSON.stringify(playerResponse()))));
});
