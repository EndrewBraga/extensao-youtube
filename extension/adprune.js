// Remove os campos de anúncio das respostas do YouTube antes de o player lê-las (uso pessoal).
// Roda no mundo MAIN da página, em document_start, para enxergar JSON.parse/fetch da própria página.
// Nunca pode quebrar a página: todo acesso fica em try/catch e só objetos conhecidos são tocados.
// Fica dentro de uma função para não criar globais que colidam com as do YouTube.
(function () {
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots'];
  const EVENT_NAME = 'ytdl-adblock'; // enviado pelo adblock.js (mundo isolado) ao ligar/desligar a chave
  const STORAGE_KEY = 'ytdl:adblock';

  function createPruner(isEnabled) {
    const strip = (obj) => {
      for (const key of AD_KEYS) if (key in obj) delete obj[key];
    };
    return function prune(value) {
      try {
        if (!isEnabled() || value === null || typeof value !== 'object') return value;
        strip(value);
        if (value.playerResponse && typeof value.playerResponse === 'object') strip(value.playerResponse);
      } catch { /* objeto congelado ou exótico: devolve como veio */ }
      return value;
    };
  }

  function install(win) {
    let enabled = true;
    try { enabled = win.localStorage.getItem(STORAGE_KEY) !== '0'; } catch { /* sem storage: ligado */ }
    const prune = createPruner(() => enabled);
    win.document.addEventListener(EVENT_NAME, (event) => { enabled = Boolean(event.detail); });

    const parse = win.JSON.parse;
    win.JSON.parse = function (...args) {
      return prune(parse.apply(this, args));
    };

    const json = win.Response?.prototype?.json;
    if (json) {
      win.Response.prototype.json = function (...args) {
        return json.apply(this, args).then(prune);
      };
    }

    // A página define a resposta inicial do player por atribuição direta a esta variável.
    try {
      let initial;
      Object.defineProperty(win, 'ytInitialPlayerResponse', {
        configurable: true,
        get: () => initial,
        set: (value) => { initial = prune(value); },
      });
    } catch { /* já definida de forma não configurável */ }
  }

  if (typeof window === 'undefined') {
    module.exports = { createPruner, install, AD_KEYS, EVENT_NAME };
  } else {
    install(window);
  }
})();
