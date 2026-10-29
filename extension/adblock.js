// Bloqueador de anúncios do YouTube (uso pessoal): esconde slots de anúncio e pula os de vídeo.
// Roda em document_start para o CSS valer antes dos anúncios aparecerem.
const AD_HIDE_SELECTORS = [
  '#masthead-ad',
  '#player-ads',
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-banner-promo-renderer',
  'ytd-statement-banner-renderer',
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-action-companion-ad-renderer',
  'ytd-companion-slot-renderer',
  'ytd-player-legacy-desktop-watch-ads-renderer',
  'ytd-brand-video-singleton-renderer',
  'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
  'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
  '.ytp-ad-overlay-container',
  '.ytp-ad-overlay-slot',
];

const AD_SKIP_BUTTONS = [
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  '.ytp-ad-skip-button-container button',
].join(',');

// Durante o anúncio, esconde o vídeo e a interface dele (selo, barra amarela, botão), para que
// o pouco tempo até o pulo pareça só uma tela escura. Cliques programáticos em itens escondidos funcionam.
const AD_PLAYER_CSS = [
  '#movie_player.ad-showing video { opacity: 0 !important; }',
  '#movie_player.ad-showing :is(.video-ads, .ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-persistent-progress-bar-container) { display: none !important; }',
].join('\n');

const AD_MAX_SEEK_SECONDS = 300; // anúncios mais longos que isso só são acelerados, nunca "pulados" no seek
const AD_TICK_MS = 150;
const STORAGE_KEY = 'ytdl:adblock';

function createAdblock(doc, storage) {
  let enabled = true;
  let timer = null;
  let saved = null; // {muted, rate} do vídeo antes do anúncio
  let observer = null;
  let observed = null;

  // Reage no instante em que o player ganha/perde a classe ad-showing, sem esperar o próximo ciclo.
  function watchPlayer(player) {
    if (typeof MutationObserver === 'undefined' || observed === player) return;
    observer?.disconnect();
    observer = new MutationObserver(() => tick());
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });
    observed = player;
  }

  function readEnabled() {
    try { return (storage ?? localStorage).getItem(STORAGE_KEY) !== '0'; } catch { return true; }
  }

  function applyCss(on) {
    const existing = doc.getElementById('ytdl-adblock-css');
    if (!on) { existing?.remove(); return; }
    if (existing) return;
    const style = doc.createElement('style');
    style.id = 'ytdl-adblock-css';
    style.textContent = AD_HIDE_SELECTORS.join(',') + ' { display: none !important; }\n' + AD_PLAYER_CSS;
    (doc.head ?? doc.documentElement).append(style);
  }

  function restore(video) {
    if (saved && video) {
      video.muted = saved.muted;
      video.playbackRate = saved.rate;
    }
    saved = null;
  }

  // Um ciclo: tira o aviso de bloqueador, acelera/pula anúncio de vídeo, restaura ao acabar.
  function tick() {
    const player = doc.querySelector('#movie_player');
    const video = player?.querySelector('video') ?? doc.querySelector('video');

    const warning = doc.querySelector('ytd-enforcement-message-view-model');
    if (warning) {
      (warning.closest('tp-yt-paper-dialog') ?? warning).remove();
      doc.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((el) => el.remove());
      video?.play?.();
    }

    if (enabled && player) watchPlayer(player);
    if (!video) return;
    if (!enabled || !player?.classList.contains('ad-showing')) {
      restore(video);
      return;
    }
    if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
    video.muted = true;
    video.playbackRate = 16;
    doc.querySelector(AD_SKIP_BUTTONS)?.click();
    const { duration, currentTime } = video;
    if (Number.isFinite(duration) && duration > 0 && duration <= AD_MAX_SEEK_SECONDS && currentTime < duration - 0.1) {
      video.currentTime = duration;
    }
  }

  function setEnabled(value, persist = true) {
    enabled = Boolean(value);
    if (persist) {
      try { (storage ?? localStorage).setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch { /* sem armazenamento */ }
    }
    applyCss(enabled);
    // Avisa o adprune.js, que roda no mundo MAIN da página.
    doc.dispatchEvent?.(new CustomEvent('ytdl-adblock', { detail: enabled }));
    if (enabled && !timer) timer = setInterval(tick, AD_TICK_MS);
    if (!enabled && timer) { clearInterval(timer); timer = null; }
    if (!enabled) { observer?.disconnect(); observer = null; observed = null; }
    tick(); // ao desligar, restaura o vídeo na hora
  }

  return {
    tick,
    setEnabled,
    get enabled() { return enabled; },
    init() { setEnabled(readEnabled(), false); },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createAdblock, AD_HIDE_SELECTORS, AD_SKIP_BUTTONS };
} else {
  globalThis.ytAdblock = createAdblock(document);
  globalThis.ytAdblock.init();
}
