const HOST = 'com.local.yt_downloader';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'download') return;
  download(msg, sender.tab?.id).then(sendResponse);
  return true; // resposta assíncrona
});

// connectNative mantém a porta (e o service worker) vivos até o host responder,
// mesmo que a aba mude de página. O progresso é repassado à aba que pediu o download.
function download({ url, mode, quality, h264 }, tabId) {
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
    port.postMessage({ type: 'download', url, mode, quality, h264 });
  });
}

function notify(result) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: result.ok ? 'Download concluído' : 'Falha no download',
    message: (result.ok ? result.file : result.error).slice(0, 300),
  });
}
