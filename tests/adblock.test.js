'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createAdblock, AD_HIDE_SELECTORS } = require('../extension/adblock.js');

// DOM mínimo: só o que o adblock usa.
function fakeDom({ adShowing = false, duration = 20, skipButton = false, warning = false } = {}) {
  const video = { muted: false, playbackRate: 1, duration, currentTime: 0, played: 0, play() { this.played++; } };
  const clicks = { skip: 0 };
  const removed = [];
  const classes = new Set(adShowing ? ['ad-showing'] : []);
  const player = {
    classList: { contains: (c) => classes.has(c) },
    querySelector: (sel) => (sel === 'video' ? video : null),
  };
  const dialog = { remove: () => removed.push('dialog') };
  const warningEl = {
    closest: (sel) => (sel === 'tp-yt-paper-dialog' ? dialog : null),
    remove: () => removed.push('warning'),
  };
  const backdrops = [{ remove: () => removed.push('backdrop') }];
  const styles = new Map();
  const doc = {
    head: null,
    documentElement: { append: (el) => styles.set(el.id, el) },
    getElementById: (id) => (styles.has(id) ? { remove: () => styles.delete(id) } : null),
    createElement: () => ({ id: '', textContent: '' }),
    querySelector: (sel) => {
      if (sel === '#movie_player') return player;
      if (sel === 'video') return video;
      if (sel === 'ytd-enforcement-message-view-model') return warning ? warningEl : null;
      if (sel.includes('ytp-skip-ad-button')) return skipButton ? { click: () => clicks.skip++ } : null;
      return null;
    },
    querySelectorAll: (sel) => (sel === 'tp-yt-iron-overlay-backdrop' ? backdrops : []),
  };
  return { doc, video, clicks, removed, styles, setAd: (on) => (on ? classes.add('ad-showing') : classes.delete('ad-showing')) };
}

const memoryStorage = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); } };
};

test('sem anúncio: não mexe no vídeo', () => {
  const d = fakeDom();
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  ab.tick();
  assert.strictEqual(d.video.muted, false);
  assert.strictEqual(d.video.playbackRate, 1);
  assert.strictEqual(d.video.currentTime, 0);
  ab.setEnabled(false);
});

test('anúncio: muta, acelera, clica em pular e vai ao fim', () => {
  const d = fakeDom({ adShowing: true, duration: 15, skipButton: true });
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  assert.strictEqual(d.video.muted, true);
  assert.strictEqual(d.video.playbackRate, 16);
  assert.strictEqual(d.video.currentTime, 15);
  assert.ok(d.clicks.skip >= 1);
  ab.setEnabled(false);
});

test('anúncio acabou: restaura volume e velocidade originais', () => {
  const d = fakeDom({ adShowing: true });
  d.video.muted = false;
  d.video.playbackRate = 1.5;
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  assert.strictEqual(d.video.playbackRate, 16);
  d.setAd(false);
  ab.tick();
  assert.strictEqual(d.video.muted, false);
  assert.strictEqual(d.video.playbackRate, 1.5);
  ab.setEnabled(false);
});

test('anúncio com vídeo já mutado: continua mutado depois', () => {
  const d = fakeDom({ adShowing: true });
  d.video.muted = true;
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  d.setAd(false);
  ab.tick();
  assert.strictEqual(d.video.muted, true);
  ab.setEnabled(false);
});

test('duração longa: acelera mas não faz seek (protege vídeo real)', () => {
  const d = fakeDom({ adShowing: true, duration: 3600 });
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  assert.strictEqual(d.video.playbackRate, 16);
  assert.strictEqual(d.video.currentTime, 0);
  ab.setEnabled(false);
});

test('duração desconhecida (NaN): sem seek', () => {
  const d = fakeDom({ adShowing: true, duration: NaN });
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  assert.strictEqual(d.video.currentTime, 0);
  ab.setEnabled(false);
});

test('desligado: ignora anúncio e restaura o vídeo na hora', () => {
  const d = fakeDom({ adShowing: true, duration: 10 });
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  assert.strictEqual(d.video.playbackRate, 16);
  ab.setEnabled(false);
  assert.strictEqual(d.video.playbackRate, 1);
  assert.strictEqual(d.video.muted, false);
  d.video.currentTime = 0;
  ab.tick();
  assert.strictEqual(d.video.playbackRate, 1);
  assert.strictEqual(d.video.currentTime, 0);
});

test('CSS: injetado ao ligar e removido ao desligar', () => {
  const d = fakeDom();
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  assert.ok(d.styles.has('ytdl-adblock-css'));
  ab.setEnabled(true); // idempotente
  assert.strictEqual(d.styles.size, 1);
  ab.setEnabled(false);
  assert.strictEqual(d.styles.size, 0);
});

test('CSS: cobre os principais slots e usa !important', () => {
  const d = fakeDom();
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  const css = d.styles.get('ytdl-adblock-css').textContent;
  for (const sel of ['#masthead-ad', 'ytd-ad-slot-renderer', '.ytp-ad-overlay-container']) {
    assert.ok(AD_HIDE_SELECTORS.includes(sel), sel);
    assert.ok(css.includes(sel), sel);
  }
  assert.match(css, /display: none !important/);
  ab.setEnabled(false);
});

test('aviso de bloqueador: remove diálogo e fundo e retoma o vídeo', () => {
  const d = fakeDom({ warning: true });
  const ab = createAdblock(d.doc, memoryStorage());
  ab.tick();
  assert.deepStrictEqual(d.removed, ['dialog', 'backdrop']);
  assert.strictEqual(d.video.played, 1);
});

test('escolha persiste: init lê o valor salvo', () => {
  const storage = memoryStorage();
  const d1 = fakeDom();
  const a = createAdblock(d1.doc, storage);
  a.setEnabled(false);
  const d2 = fakeDom();
  const b = createAdblock(d2.doc, storage);
  b.init();
  assert.strictEqual(b.enabled, false);
  assert.strictEqual(d2.styles.size, 0);
  b.setEnabled(true);
  const c = createAdblock(fakeDom().doc, storage);
  c.init();
  assert.strictEqual(c.enabled, true);
  c.setEnabled(false, false);
  b.setEnabled(false);
});

test('sem valor salvo: começa ligado', () => {
  const d = fakeDom();
  const ab = createAdblock(d.doc, memoryStorage());
  ab.init();
  assert.strictEqual(ab.enabled, true);
  assert.ok(d.styles.has('ytdl-adblock-css'));
  ab.setEnabled(false, false);
});

test('CSS: esconde vídeo e interface do anúncio só durante ad-showing', () => {
  const d = fakeDom();
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  const css = d.styles.get('ytdl-adblock-css').textContent;
  assert.match(css, /#movie_player\.ad-showing video \{ opacity: 0 !important; \}/);
  assert.match(css, /#movie_player\.ad-showing :is\([^)]*\.video-ads[^)]*\) \{ display: none !important; \}/);
  ab.setEnabled(false);
});

test('observer: reage à mudança de classe do player sem esperar o ciclo', () => {
  const created = [];
  global.MutationObserver = class {
    constructor(cb) { this.cb = cb; this.disconnected = false; created.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.disconnected = true; }
  };
  try {
    const d = fakeDom();
    const ab = createAdblock(d.doc, memoryStorage());
    ab.setEnabled(true);
    assert.strictEqual(created.length, 1);
    assert.deepStrictEqual(created[0].opts, { attributes: true, attributeFilter: ['class'] });
    ab.tick(); // mesmo player: não cria outro observer
    assert.strictEqual(created.length, 1);
    d.setAd(true);
    assert.strictEqual(d.video.playbackRate, 1); // ainda sem tick
    created[0].cb(); // o navegador avisa da mudança de classe
    assert.strictEqual(d.video.playbackRate, 16);
    assert.strictEqual(d.video.muted, true);
    ab.setEnabled(false);
    assert.strictEqual(created[0].disconnected, true);
  } finally {
    delete global.MutationObserver;
  }
});

test('setEnabled: avisa o adprune pelo evento ytdl-adblock', () => {
  const d = fakeDom();
  const events = [];
  d.doc.dispatchEvent = (e) => events.push([e.type, e.detail]);
  const ab = createAdblock(d.doc, memoryStorage());
  ab.setEnabled(true);
  ab.setEnabled(false);
  assert.deepStrictEqual(events, [['ytdl-adblock', true], ['ytdl-adblock', false]]);
});
