// notify.js — controlla su AniList se sono usciti nuovi episodi per i titoli
// in watchlist.json e, se sì, invia una notifica Telegram. Pensato per girare
// come job schedulato (GitHub Actions).
//
// Richiede due variabili d'ambiente: TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID.

const fs = require('fs');
const path = require('path');

const WATCHLIST_PATH = path.join(__dirname, 'watchlist.json');
const STATE_PATH = path.join(__dirname, 'notify-state.json');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fallback; }
}

async function anilistQuery(query, variables) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'AniList error');
  return json.data;
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID mancanti.');
    return;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
  });
  if (!res.ok) console.error('Invio Telegram fallito:', await res.text());
}

function latestAiredEpisode(m) {
  if (m.nextAiringEpisode) return Math.max(0, m.nextAiringEpisode.episode - 1);
  if (m.episodes) return m.episodes;
  return 0;
}

async function main() {
  const watchlist = loadJSON(WATCHLIST_PATH, []);
  if (!watchlist.length) {
    console.log('watchlist.json è vuoto, niente da controllare.');
    return;
  }
  const state = loadJSON(STATE_PATH, {}); // { [aniListId]: lastNotifiedEpisode }

  const ids = watchlist.map(w => w.aniListId);
  const data = await anilistQuery(`
    query ($ids: [Int]) {
      Page(page:1, perPage:50){
        media(id_in:$ids, type:ANIME){
          id title{ romaji english } episodes status
          nextAiringEpisode{ episode airingAt }
        }
      }
    }`, { ids });

  const mediaById = {};
  data.Page.media.forEach(m => { mediaById[m.id] = m; });

  let notified = false;

  for (const w of watchlist) {
    const m = mediaById[w.aniListId];
    if (!m) continue;
    const latest = latestAiredEpisode(m);
    const lastNotified = state[w.aniListId] || 0;
    if (latest > lastNotified) {
      const title = w.alias || m.title.english || m.title.romaji;
      await sendTelegram(`📺 <b>${title}</b>\nEpisodio ${latest} è uscito.`);
      state[w.aniListId] = latest;
      notified = true;
    }
  }

  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(notified ? 'Notifiche inviate, stato aggiornato.' : 'Nessun nuovo episodio.');
}

main().catch(err => {
  console.error('Errore nello script:', err);
  process.exit(1);
});
