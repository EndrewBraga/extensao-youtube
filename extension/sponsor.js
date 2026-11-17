// Helpers do SponsorBlock (https://sponsor.ajay.app) para pular patrocínios na reprodução.
// Usado pelo service worker (importScripts) e pelo content script. Dentro de uma função para não vazar globais.
// Privacidade: a consulta envia só os 4 primeiros caracteres do hash SHA-256 do ID do vídeo, nunca o ID.
(function () {
  const API = 'https://sponsor.ajay.app/api/skipSegments/';
  const CATEGORIES = ['sponsor', 'selfpromo', 'interaction'];
  const VIDEO_ID = /^[\w-]{11}$/;

  async function hashPrefix(videoId) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId));
    return [...new Uint8Array(digest).slice(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function buildUrl(prefix) {
    const query = new URLSearchParams();
    for (const category of CATEGORIES) query.append('category', category);
    query.append('actionType', 'skip');
    return API + prefix + '?' + query;
  }

  // Da resposta (vários vídeos com o mesmo prefixo) devolve os trechos [início, fim] deste vídeo,
  // ordenados e com sobreposições unidas.
  function parseSegments(list, videoId) {
    if (!Array.isArray(list)) return [];
    const entry = list.find((v) => v?.videoID === videoId);
    const raw = (Array.isArray(entry?.segments) ? entry.segments : [])
      .filter((s) => s?.actionType === 'skip' && CATEGORIES.includes(s.category))
      .map((s) => s.segment)
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > p[0] && p[0] >= 0)
      .map(([start, end]) => [start, end])
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const seg of raw) {
      const last = merged[merged.length - 1];
      if (last && seg[0] <= last[1]) last[1] = Math.max(last[1], seg[1]);
      else merged.push(seg);
    }
    return merged;
  }

  // Se `time` está dentro de um trecho, devolve o fim dele (para onde pular); senão null.
  function findSkip(segments, time) {
    for (const [start, end] of segments) {
      if (time >= start - 0.05 && time < end - 0.25) return end;
    }
    return null;
  }

  async function fetchSegments(videoId, fetchFn = fetch) {
    if (!VIDEO_ID.test(videoId ?? '')) throw new Error('ID de vídeo inválido');
    const res = await fetchFn(buildUrl(await hashPrefix(videoId)));
    if (res.status === 404) return []; // ninguém marcou trechos nesse prefixo
    if (!res.ok) throw new Error('SponsorBlock respondeu ' + res.status);
    return parseSegments(await res.json(), videoId);
  }

  const api = { hashPrefix, buildUrl, parseSegments, findSkip, fetchSegments, CATEGORIES };
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.ytSponsor = api;
})();
