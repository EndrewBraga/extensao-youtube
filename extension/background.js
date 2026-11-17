const HOST = 'com.local.yt_downloader';
const FILE_NOTIFICATION_PREFIX = 'file:'; // o id da notificação carrega o caminho para o clique abrir o arquivo

importScripts('sponsor.js'); // define globalThis.ytSponsor

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'download') {
    download(msg, sender.tab?.id).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg?.type === 'open') {
    openPath(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'sponsorSegments') {
    sponsorSegments(msg.videoId).then(sendResponse);
    return true;
  }
});

// connectNative mantém a porta (e o service worker) vivos até o host responder,
// mesmo que a aba mude de página. O progresso é repassado à aba que pediu o download.
function download({ url, mode, quality, h264, start, end, sponsorblock }, tabId) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      notify(result);
      resolve(result);
    };

    let port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch (e) {
      finish({ ok: false, error: e.message });
      return;
    }
    port.onMessage.addListener((res) => {
      if (res?.type === 'progress') {
        if (tabId !== undefined) chrome.tabs.sendMessage(tabId, res).catch(() => {}); // aba pode ter fechado
        return;
      }
      finish(res?.ok ? { ok: true, file: res.file } : { ok: false, error: res?.error || 'Erro desconhecido' });
      port.disconnect(); // o host sai ao ver a porta fechada
    });
    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || 'O host encerrou sem responder';
      finish({ ok: false, error: reason });
    });
    port.postMessage({ type: 'download', url, mode, quality, h264, start, end, sponsorblock });
  });
}

// Pede ao host para abrir a pasta de downloads ou mostrar um arquivo no Explorer.
function openPath({ target, file }) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    let port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch (e) {
      finish({ ok: false, error: e.message });
      return;
    }
    port.onMessage.addListener((res) => {
      finish(res?.ok ? { ok: true } : { ok: false, error: res?.error || 'Erro desconhecido' });
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      finish({ ok: false, error: chrome.runtime.lastError?.message || 'O host encerrou sem responder' });
    });
    port.postMessage({ type: 'open', target, file });
  });
}

const segmentCache = new Map(); // videoId -> trechos; vale enquanto o service worker estiver vivo

async function sponsorSegments(videoId) {
  try {
    if (!segmentCache.has(videoId)) segmentCache.set(videoId, await ytSponsor.fetchSegments(videoId));
    return { ok: true, segments: segmentCache.get(videoId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function notify(result) {
  const options = {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: result.ok ? 'Download concluído' : 'Falha no download',
    message: (result.ok ? result.file : result.error).slice(0, 300),
  };
  if (result.ok) {
    options.contextMessage = 'Clique para mostrar na pasta';
    chrome.notifications.create(FILE_NOTIFICATION_PREFIX + result.file, options);
  } else {
    chrome.notifications.create(options);
  }
}

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith(FILE_NOTIFICATION_PREFIX)) return;
  openPath({ target: 'file', file: id.slice(FILE_NOTIFICATION_PREFIX.length) });
  chrome.notifications.clear(id);
});
