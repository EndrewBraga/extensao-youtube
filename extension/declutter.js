// Chaves para esconder partes do YouTube (Shorts, comentários, recomendados, sugestões do fim do vídeo).
// Roda em document_start para o CSS valer antes de a página aparecer. Tudo desligado por padrão.
(function () {
  const OPTIONS = [
    {
      key: 'shorts',
      label: 'Esconder Shorts',
      css: [
        'ytd-reel-shelf-renderer',
        'ytd-rich-shelf-renderer[is-shorts]',
        'ytd-rich-section-renderer:has(ytd-reel-shelf-renderer)',
        'ytd-guide-entry-renderer:has(a[title="Shorts"])',
        'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
        'ytd-video-renderer:has(a[href^="/shorts/"])',
        'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
        'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
        'ytd-compact-video-renderer:has(a[href^="/shorts/"])',
        'yt-lockup-view-model:has(a[href^="/shorts/"])',
      ],
    },
    { key: 'comments', label: 'Esconder comentários', css: ['ytd-comments#comments'] },
    {
      key: 'related',
      label: 'Esconder recomendados',
      css: ['#related', 'ytd-watch-next-secondary-results-renderer'],
    },
    {
      key: 'endscreen',
      label: 'Esconder sugestões do fim',
      css: ['.html5-endscreen', '.ytp-ce-element', '.ytp-endscreen-content', '.ytp-ce-covering-overlay'],
    },
  ];

  const PREFIX = 'ytdl:hide:';

  function createDeclutter(doc, storage) {
    const state = {};

    const store = () => storage ?? localStorage;
    const styleId = (key) => 'ytdl-hide-' + key;

    function apply(option, on) {
      const existing = doc.getElementById(styleId(option.key));
      if (!on) { existing?.remove(); return; }
      if (existing) return;
      const style = doc.createElement('style');
      style.id = styleId(option.key);
      style.textContent = option.css.join(',') + ' { display: none !important; }';
      (doc.head ?? doc.documentElement).append(style);
    }

    function set(key, value, persist = true) {
      const option = OPTIONS.find((o) => o.key === key);
      if (!option) return;
      state[key] = Boolean(value);
      if (persist) {
        try { store().setItem(PREFIX + key, state[key] ? '1' : '0'); } catch { /* sem armazenamento */ }
      }
      apply(option, state[key]);
    }

    return {
      options: OPTIONS,
      isOn: (key) => state[key] === true,
      set,
      init() {
        for (const option of OPTIONS) {
          let saved = false;
          try { saved = store().getItem(PREFIX + option.key) === '1'; } catch { /* desligado */ }
          set(option.key, saved, false);
        }
      },
    };
  }

  if (typeof module !== 'undefined') {
    module.exports = { createDeclutter, OPTIONS };
  } else {
    globalThis.ytDeclutter = createDeclutter(document);
    globalThis.ytDeclutter.init();
  }
})();
