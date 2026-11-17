'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createDeclutter, OPTIONS } = require('../extension/declutter.js');

function fakeDoc() {
  const styles = new Map();
  return {
    styles,
    head: null,
    documentElement: { append: (el) => styles.set(el.id, el) },
    getElementById: (id) => (styles.has(id) ? { remove: () => styles.delete(id) } : null),
    createElement: () => ({ id: '', textContent: '' }),
  };
}

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); } };
};

test('opções: chaves únicas, rótulos e seletores', () => {
  assert.deepStrictEqual(OPTIONS.map((o) => o.key), ['shorts', 'comments', 'related', 'endscreen']);
  for (const o of OPTIONS) {
    assert.ok(o.label && o.css.length > 0, o.key);
  }
});

test('começa tudo desligado', () => {
  const doc = fakeDoc();
  const d = createDeclutter(doc, memoryStorage());
  d.init();
  assert.strictEqual(doc.styles.size, 0);
  for (const o of OPTIONS) assert.strictEqual(d.isOn(o.key), false);
});

test('set liga e desliga o CSS da opção, sem duplicar', () => {
  const doc = fakeDoc();
  const d = createDeclutter(doc, memoryStorage());
  d.set('shorts', true);
  d.set('shorts', true);
  assert.strictEqual(doc.styles.size, 1);
  const css = doc.styles.get('ytdl-hide-shorts').textContent;
  assert.ok(css.includes('ytd-reel-shelf-renderer'));
  assert.match(css, /display: none !important/);
  d.set('shorts', false);
  assert.strictEqual(doc.styles.size, 0);
  assert.strictEqual(d.isOn('shorts'), false);
});

test('opções são independentes', () => {
  const doc = fakeDoc();
  const d = createDeclutter(doc, memoryStorage());
  d.set('comments', true);
  d.set('related', true);
  assert.deepStrictEqual([...doc.styles.keys()].sort(), ['ytdl-hide-comments', 'ytdl-hide-related']);
  d.set('comments', false);
  assert.deepStrictEqual([...doc.styles.keys()], ['ytdl-hide-related']);
});

test('persistência: init lê o que foi salvo', () => {
  const storage = memoryStorage();
  createDeclutter(fakeDoc(), storage).set('endscreen', true);
  assert.strictEqual(storage.data['ytdl:hide:endscreen'], '1');
  const doc = fakeDoc();
  const d = createDeclutter(doc, storage);
  d.init();
  assert.strictEqual(d.isOn('endscreen'), true);
  assert.strictEqual(d.isOn('shorts'), false);
  assert.ok(doc.styles.has('ytdl-hide-endscreen'));
});

test('init não regrava o armazenamento', () => {
  const storage = memoryStorage({ 'ytdl:hide:shorts': '1' });
  const before = JSON.stringify(storage.data);
  createDeclutter(fakeDoc(), storage).init();
  assert.strictEqual(JSON.stringify(storage.data), before);
});

test('chave desconhecida é ignorada', () => {
  const doc = fakeDoc();
  const d = createDeclutter(doc, memoryStorage());
  assert.doesNotThrow(() => d.set('nao-existe', true));
  assert.strictEqual(doc.styles.size, 0);
});

test('sem armazenamento disponível não quebra', () => {
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const doc = fakeDoc();
  const d = createDeclutter(doc, broken);
  assert.doesNotThrow(() => d.init());
  assert.doesNotThrow(() => d.set('shorts', true));
  assert.ok(doc.styles.has('ytdl-hide-shorts'));
});
