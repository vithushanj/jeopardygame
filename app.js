(() => {
'use strict';

// ---------- data ----------
const RAW = window.CLUE_BANK || { cats: [], clues: [] };
const CUR = Object.assign({ cats: [], finals: [], boards: [] }, window.CURATED);
const DIFF = ['easy', 'medium', 'hard'];
const ROWD = [0, 0, 1, 1, 2];              // difficulty of each row in a hand-written category
const BASE = [200, 400, 600, 800, 1000];
const NCAT = 6;
const LEVELS = ['Easy', 'Standard', 'Hard'];
// difficulty of each of the 5 rows, top to bottom; later rounds shift one profile harder
const PROFILES = [[0, 0, 0, 1, 1], [0, 0, 1, 1, 2], [0, 1, 1, 2, 2], [1, 1, 2, 2, 2]];
const TOPICS = ['History', 'Geography', 'Science', 'Tech', 'Literature', 'Arts', 'Music', 'Film & TV', 'Pop Culture', 'Games', 'Sports', 'Food & Drink', 'Wordplay', 'Potpourri', 'Holiday'];
const BANK_TOPIC = {
  'Animals': 'Science', 'Art': 'Arts', 'Celebrities': 'Pop Culture', 'Entertainment: Board Games': 'Games',
  'Entertainment: Books': 'Literature', 'Entertainment: Cartoon & Animations': 'Film & TV', 'Entertainment: Comics': 'Pop Culture',
  'Entertainment: Film': 'Film & TV', 'Entertainment: Japanese Anime & Manga': 'Games', 'Entertainment: Music': 'Music',
  'Entertainment: Musicals & Theatres': 'Arts', 'Entertainment: Television': 'Film & TV', 'Entertainment: Video Games': 'Games',
  'General Knowledge': 'Potpourri', 'Geography': 'Geography', 'History': 'History', 'Mythology': 'Literature', 'Politics': 'History',
  'Science & Nature': 'Science', 'Science: Computers': 'Tech', 'Science: Gadgets': 'Tech', 'Science: Mathematics': 'Science',
  'Sports': 'Sports', 'Vehicles': 'Tech',
};
const short = n => n.replace(/^(Entertainment|Science): /, '');

// every place a category can come from: hand-written sets first, then open-bank categories
const SRC = [
  ...CUR.cats.map((c, i) => ({ key: 'c' + i, kind: 'cur', title: c.t, topic: c.k })),
  ...RAW.cats.map((n, i) => ({ key: 'b' + i, kind: 'bank', title: short(n), topic: BANK_TOPIC[n] || 'Potpourri' })),
];
const SRCBY = Object.fromEntries(SRC.map(s => [s.key, s]));
// every single clue, searchable
const BANK = [
  ...CUR.cats.flatMap((c, i) => c.c.map((x, j) => ({ id: `c${i}-${j}`, key: 'c' + i, diff: ROWD[j], clue: x[0], answer: x[1] }))),
  ...RAW.clues.map((a, i) => ({ id: 'b' + i, key: 'b' + a[0], diff: a[1], clue: a[2], answer: a[3] })),
];
BANK.forEach(c => { c.hay = (c.clue + ' ' + c.answer + ' ' + SRCBY[c.key].title + ' ' + SRCBY[c.key].topic).toLowerCase(); });
const BYID = Object.fromEntries(BANK.map(c => [c.id, c]));

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
let boards = store.get('tb.boards', []);
let game = store.get('tb.game', null);
let opts = Object.assign({ level: 1, rounds: 2, source: 'cur', topics: TOPICS.filter(t => t !== 'Holiday') }, store.get('tb.opts', {}));
let muted = store.get('tb.mute', false);
const saveBoards = () => store.set('tb.boards', boards);
const saveGame = () => store.set('tb.game', game);

// ---------- helpers ----------
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const slim = c => ({ clue: c.clue, answer: c.answer, diff: c.diff, id: c.id });
// YouTube clips embed when the page is served from its own website; inside a claude.ai artifact
// (or opened as a local file) embeds are blocked, so clips open in a new tab instead.
const CAN_EMBED = /^https?:$/.test(location.protocol) && !/claude/i.test(location.hostname);
function ytInfo(u) {
  let url; try { url = new URL(String(u || '').trim()); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
    id = m ? m[1] : url.searchParams.get('v');
  }
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
  const secs = v => {                      // "90", "1m30s", "1:30"
    if (!v) return 0;
    if (/^\d+$/.test(v)) return +v;
    if (/^\d+(:\d+)+$/.test(v)) return v.split(':').reduce((a, x) => a * 60 + +x, 0);
    const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  };
  return { id, start: secs(url.searchParams.get('t') || url.searchParams.get('start')), end: secs(url.searchParams.get('end')) };
}
const safeLink = u => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
const roundName = r => `Round ${r + 1}` + (r === 1 ? ' · double' : r === 2 ? ' · triple' : '');
const filled = cat => cat.clues.filter(Boolean).length;
const profileFor = r => PROFILES[Math.min(opts.level + Math.min(r, 1), PROFILES.length - 1)];
const boardIds = b => new Set(b.rounds.flatMap(rd => rd.cats.flatMap(c => c.clues.filter(Boolean).map(x => x.id))));
const boardKeys = b => new Set(b.rounds.flatMap(rd => rd.cats.map(c => c.key)));

// ---------- generation ----------
function pickOne(key, diff, taken) {
  const pool = BANK.filter(c => c.key === key && !taken.has(c.id));
  return shuffle(pool.filter(c => c.diff === diff))[0] || shuffle(pool.filter(c => Math.abs(c.diff - diff) === 1))[0] || shuffle(pool)[0] || null;
}
function genCat(src, r, taken) {
  let clues;
  if (src.kind === 'cur') {
    clues = BANK.filter(c => c.key === src.key).map(slim);
  } else {
    clues = [];
    for (const d of profileFor(r)) {
      const c = pickOne(src.key, d, taken);
      if (!c) return null;
      taken.add(c.id); clues.push(slim(c));
    }
    clues.sort((a, b) => a.diff - b.diff);       // easiest at the top, hardest at the bottom
  }
  clues.forEach(c => taken.add(c.id));
  return { title: src.title, key: src.key, clues };
}
function pickSrc(b, round, skip) {
  const used = boardKeys(b), topics = new Set(round.cats.map(c => (SRCBY[c.key] || {}).topic));
  const ok = s => opts.topics.includes(s.topic) && !skip.has(s.key);
  const kinds = opts.source === 'cur' ? ['cur'] : opts.source === 'bank' ? ['bank'] : ['cur', 'bank'];
  let pool = SRC.filter(s => ok(s) && kinds.includes(s.kind) && !used.has(s.key));
  if (!pool.length) pool = SRC.filter(s => ok(s) && !used.has(s.key));           // hand-written sets ran out
  if (!pool.length) pool = SRC.filter(s => ok(s) && s.kind === 'bank');          // reuse an open-bank category, with fresh clues
  if (!pool.length) pool = SRC.filter(s => !skip.has(s.key) && !used.has(s.key)); // topic filter too narrow
  const fresh = pool.filter(s => !topics.has(s.topic));                          // spread topics across a round
  return shuffle(fresh.length ? fresh : pool)[0] || null;
}
function newCat(b, r) {
  const taken = boardIds(b), skip = new Set();
  for (let i = 0; i < 40; i++) {
    const src = pickSrc(b, b.rounds[r], skip);
    if (!src) return null;
    const cat = genCat(src, r, taken);
    if (cat) return cat;
    skip.add(src.key);
  }
  return null;
}
function fillRound(b, r) {
  while (b.rounds[r].cats.length < NCAT) {
    const cat = newCat(b, r);
    if (!cat) break;
    b.rounds[r].cats.push(cat);
  }
}
function genFinal(b, not) {
  const taken = boardIds(b);
  const cur = opts.source === 'bank' ? [] : CUR.finals.filter(f => f.clue !== not);
  const f = shuffle(cur.filter(x => opts.topics.includes(x.k)))[0] || shuffle(cur)[0];
  if (f && (opts.source !== 'mix' || Math.random() < 0.7)) return { title: f.t, clue: f.clue, answer: f.answer };
  const pool = BANK.filter(c => c.key[0] === 'b' && c.diff === 2 && !taken.has(c.id) && c.clue !== not && opts.topics.includes(SRCBY[c.key].topic));
  const c = shuffle(pool)[0];
  return c ? { title: SRCBY[c.key].title, clue: c.clue, answer: c.answer } : f ? { title: f.t, clue: f.clue, answer: f.answer } : { title: '', clue: '', answer: '' };
}
function genBoard(id, name) {
  const b = { id: id || uid(), name: name || `Board ${boards.length + 1}`, rounds: [], final: { title: '', clue: '', answer: '' } };
  for (let r = 0; r < opts.rounds; r++) { b.rounds.push({ cats: [] }); fillRound(b, r); }
  b.final = genFinal(b);
  return b;
}

const myCopy = p => boards.find(b => b.preset === p.name) || boards.find(b => !b.preset && b.name === p.name);
function fromPreset(p) {
  const cat = x => {
    if (typeof x === 'string') return genCat(SRC.find(s => s.kind === 'cur' && s.title === x), 0, new Set());
    return { title: x.t, key: null, clues: x.c.map((q, j) => Object.assign({ clue: q[0], answer: q[1], diff: ROWD[j], id: 'p' + uid() }, q[2] ? { link: q[2] } : {})) };
  };
  return { id: uid(), name: p.name, preset: p.name, rounds: p.rounds.map(r => ({ cats: r.map(cat) })), final: { title: p.final.t, clue: p.final.clue, answer: p.final.answer } };
}

// ---------- sound + motion ----------
let ac = null;
function sfx(name) {
  if (muted) return;
  const seq = { open: [[440, .07], [660, .12]], reveal: [[587, .1]], right: [[523, .09], [659, .09], [784, .22]], wrong: [[196, .16], [147, .3]],
    wild: [[392, .09], [523, .09], [659, .09], [784, .09], [1047, .35]], win: [[523, .12], [659, .12], [784, .12], [1047, .12], [784, .1], [1047, .5]] }[name];
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    let t = ac.currentTime;
    for (const [f, d] of seq) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(.14, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d); t += d * .85;
    }
  } catch { /* no audio */ }
}
const fx = { deal: false, pop: false, bump: -1, confetti: false };
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas'); cv.className = 'confetti'; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'), W = cv.width = innerWidth, H = cv.height = innerHeight;
  const cols = ['#7ef0c1', '#ff7a59', '#ffd166', '#b69cff', '#5cc8ff'];
  const ps = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * .6, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, s: 5 + Math.random() * 7, r: Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();
  (function tick(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) { p.x += p.vx; p.y += p.vy; p.r += .12; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
    if (t - t0 < 5000) requestAnimationFrame(tick); else cv.remove();
  })(t0);
}

// ---------- in-page dialogs (native confirm/prompt/alert are unavailable in some hosts) ----------
const dlg = document.createElement('div');
dlg.className = 'modal'; dlg.hidden = true; document.body.appendChild(dlg);
let dlgCb = null;
function ask(msg, cb, o = {}) {
  dlgCb = cb;
  dlg.innerHTML = `<div class="box"><p>${esc(msg)}</p>
    ${o.input != null ? `<input id="dlgIn" value="${esc(o.input)}" style="width:100%">` : ''}
    ${o.area != null ? `<textarea id="dlgIn" rows="10" ${o.readonly ? 'readonly' : ''}>${esc(o.area)}</textarea>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px">${o.extra || ''}${cb ? '<button data-a="dlgNo">Cancel</button>' : ''}
      <button class="primary" data-a="dlgYes">${o.ok || 'OK'}</button></div></div>`;
  dlg.hidden = false;
  const f = dlg.querySelector('#dlgIn') || dlg.querySelector('.primary');
  f.focus(); if (f.select) f.select();
}
// ---------- images ----------
// A clue's picture is either a web address (https://…, or a file path inside this site) or an image
// uploaded from the host's computer. Uploads are shrunk and kept in this browser's IndexedDB (far
// roomier than localStorage), and clues point at them as "idb:<key>". Exports embed them as data.
const IMG_MAX = 1600;
const imgCache = new Map();
let imgDbP = null;
function imgDb() {
  if (!imgDbP) imgDbP = new Promise((res, rej) => {
    const r = indexedDB.open('tb-images', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('imgs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return imgDbP;
}
async function imgPut(dataUrl) {
  const key = 'i' + Date.now().toString(36) + uid();
  const db = await imgDb();
  await new Promise((res, rej) => { const t = db.transaction('imgs', 'readwrite'); t.objectStore('imgs').put(dataUrl, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
  imgCache.set(key, dataUrl);
  return 'idb:' + key;
}
async function imgGet(key) {
  if (imgCache.has(key)) return imgCache.get(key);
  const db = await imgDb();
  const v = await new Promise((res, rej) => { const r = db.transaction('imgs').objectStore('imgs').get(key); r.onsuccess = () => res(r.result || ''); r.onerror = () => rej(r.error); });
  if (v) imgCache.set(key, v);
  return v;
}
const imgOk = u => /^(https?:\/\/|idb:|data:image\/|images\/)/i.test(String(u || '').trim());
function imgTag(u, cls) {
  u = String(u || '').trim();
  if (!imgOk(u)) return '';
  if (u.startsWith('idb:')) { const k = u.slice(4); return `<img class="${cls}" alt="" data-idb="${esc(k)}"${imgCache.has(k) ? ` src="${esc(imgCache.get(k))}"` : ''}>`; }
  return `<img class="${cls}" alt="" src="${esc(u)}">`;
}
function hydrateImgs() {
  document.querySelectorAll('img[data-idb]:not([src])').forEach(el => {
    imgGet(el.dataset.idb).then(v => { if (v) el.src = v; }).catch(() => {});
  });
}
function shrinkImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, IMG_MAX / Math.max(im.width, im.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);   // flatten transparent maps onto white
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      res(cv.toDataURL('image/jpeg', 0.86));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not an image this browser can open.')); };
    im.src = url;
  });
}
const eachClue = (b, fn) => { b.rounds.forEach(r => r.cats.forEach(c => c.clues.forEach(cl => { if (cl) fn(cl); }))); if (b.final) fn(b.final); };
async function boardForExport(b) {
  const out = clone(b), jobs = [];
  eachClue(out, cl => { if (String(cl.img || '').startsWith('idb:')) jobs.push(imgGet(cl.img.slice(4)).then(v => { cl.img = v || ''; })); });
  await Promise.all(jobs);
  return out;
}
let exportText = '', exportName = 'board.json';
async function importText(text) {
  try {
    const b = JSON.parse(text);
    if (!Array.isArray(b.rounds) || !b.rounds.every(r => Array.isArray(r.cats))) throw new Error('not a board file');
    b.id = uid(); b.name = b.name || 'Imported board'; b.final = b.final || { title: '', clue: '', answer: '' };
    const jobs = [];
    eachClue(b, cl => { if (String(cl.img || '').startsWith('data:image/')) jobs.push(imgPut(cl.img).then(ref => { cl.img = ref; })); });
    await Promise.all(jobs);
    boards.unshift(b); saveBoards(); render();
  } catch (err) { ask('Could not import that board: ' + err.message); }
}

// ---------- view state ----------
let view = 'home';
let edit = null;            // board being edited (autosaved)
let hist = [];              // undo stack for the editor
let typing = false;
let tab = 0;                // round index, or 'final'
let sel = null;             // {c, i} selected clue in current round
let showOpts = false, showFind = false;
let search = { q: '', key: '', diff: '' };
let setup = { boardId: null, names: store.get('tb.teams', ['Team 1', 'Team 2', 'Team 3']), split: store.get('tb.split', true), wild: store.get('tb.wild', 2) };
const isScreen = () => location.hash === '#screen';     // the guest screen: follows the host's game, never shows a response early

function go(v) { view = v; render(); window.scrollTo(0, 0); }
function render() {
  if (!isScreen()) guestReady = false;
  app.innerHTML = isScreen() ? vScreen() : ({ home: vHome, editor: vEditor, setup: vSetup, play: vPlay })[view]();
  if (view === 'editor' && showFind) renderResults();
  fx.deal = fx.pop = false; fx.bump = -1;
  if (fx.confetti) { fx.confetti = false; confetti(); }
  placeClip();
  hydrateImgs();
}
function saveEdit() {
  const i = boards.findIndex(b => b.id === edit.id);
  if (i >= 0) boards[i] = clone(edit); else boards.unshift(clone(edit));
  saveBoards();
}
function snap() { hist.push(JSON.stringify(edit)); if (hist.length > 40) hist.shift(); }
function mut(fn) { snap(); typing = false; fn(); saveEdit(); render(); }      // one undoable change to the board
function touch() { if (!typing) { snap(); typing = true; } }                  // first keystroke in a text field

// ---------- home ----------
function boardSummary(b) {
  return b.rounds.map((rd, r) => `<div class="chips"><span class="chip"><b>${roundName(r)}</b></span>` +
    (rd.cats.map(c => `<span class="chip">${esc(c.title)}</span>`).join('') || '<span class="chip">empty</span>') + '</div>').join('') +
    `<div class="chips"><span class="chip"><b>Final</b></span><span class="chip">${esc(b.final.title || '—')}</span></div>`;
}
function vHome() {
  const resume = game ? `<div class="card banner row spread"><div><b>Game in progress:</b> ${esc(game.board.name)} — ${game.teams.map(t => esc(t.name)).join(', ')}</div>
    <div class="row"><button class="primary" data-a="resume">Resume</button><button class="warn" data-a="abandon">Discard</button></div></div>` : '';
  const list = boards.length ? boards.map(b => `<div class="card">
      <div class="row spread"><h3>${esc(b.name)}</h3><div class="row">
        <button class="primary small" data-a="host" data-id="${b.id}">Host game</button>
        <button class="small" data-a="editBoard" data-id="${b.id}">Edit</button>
        <button class="small" data-a="dupBoard" data-id="${b.id}">Duplicate</button>
        <button class="small" data-a="exportBoard" data-id="${b.id}">Export</button>
        <button class="small warn" data-a="delBoard" data-id="${b.id}">Delete</button></div></div>
      ${boardSummary(b)}</div>`).join('')
    : '<div class="card">No boards yet. "New board" builds a complete one in a click; you can then tweak anything on it.</div>';
  return `<header class="hero"><h1>Trivia <span>Board</span></h1>
      <p class="sub">Host a quiz-board night for 2–5 teams. ${CUR.cats.length} hand-written categories, plus ${RAW.clues.length.toLocaleString()} open-bank clues.</p>
      <div class="row"><button class="primary big" data-a="newBoard">＋ New board</button><button data-a="importBoard">Import board</button><button data-a="goScreen" title="Turn this window into the screen your guests see">Guest screen</button></div></header>
    ${resume}<h2>Your boards</h2>${list}
    ${CUR.boards.length ? '<h2>Ready-made boards</h2>' + CUR.boards.map((p, n) => `<div class="card"><div class="row spread"><h3>${esc(p.name)}</h3>
      ${myCopy(p) ? `<div class="row"><span class="sub">You have a copy</span><button class="small" data-a="usePreset" data-n="${n}">Replace my copy with this version</button></div>`
        : `<button class="primary small" data-a="usePreset" data-n="${n}">Add to my boards</button>`}</div>
      ${p.rounds.map((r, i) => `<div class="chips"><span class="chip"><b>${roundName(i)}</b></span>${r.map(x => `<span class="chip">${esc(typeof x === 'string' ? x : x.t)}</span>`).join('')}</div>`).join('')}
      <div class="chips"><span class="chip"><b>Final</b></span><span class="chip">${esc(p.final.t)}</span></div></div>`).join('') : ''}`;
}

// ---------- editor ----------
function optsPanel() {
  return `<div class="card opts">
    <div class="row">
      <label>Clues from <select data-i="oSource">
        <option value="cur" ${opts.source === 'cur' ? 'selected' : ''}>Hand-written categories</option>
        <option value="mix" ${opts.source === 'mix' ? 'selected' : ''}>Hand-written + open bank</option>
        <option value="bank" ${opts.source === 'bank' ? 'selected' : ''}>Open bank only</option></select></label>
      <label>Rounds <select data-i="oRounds">${[1, 2, 3].map(n => `<option value="${n}" ${opts.rounds === n ? 'selected' : ''}>${n} + final</option>`).join('')}</select></label>
      <label>Open-bank difficulty <select data-i="oLevel">${LEVELS.map((l, i) => `<option value="${i}" ${i === opts.level ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="chips" style="margin-top:10px">${TOPICS.map(t => `<button class="chip tog ${opts.topics.includes(t) ? 'on' : ''}" data-a="oTopic" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
      <button class="small" data-a="oAll">All</button></div>
    <p class="sub" style="margin:8px 0 0">Every category runs easiest at the top to hardest at the bottom. These settings apply to anything you generate or swap from now on.</p>
    <p style="margin:10px 0 0"><button data-a="regenAll">↻ Regenerate the whole board with these settings</button></p></div>`;
}
function clueCard(cat, ci, i, r) {
  const cl = cat.clues[i], val = BASE[i] * (r + 1), isSel = sel && sel.c === ci && sel.i === i;
  if (isSel) {
    const canSwap = cat.key && cat.key[0] === 'b';
    return `<div class="clue-card sel">
      <div class="row spread"><span class="v">${val}</span><button class="small" data-a="unsel">Done</button></div>
      <textarea rows="4" data-i="sClue" placeholder="Clue">${esc(cl ? cl.clue : '')}</textarea>
      <input data-i="sAnswer" placeholder="Correct response" value="${esc(cl ? cl.answer : '')}">
      <input data-i="sLink" placeholder="Clip link, optional (YouTube or any https:// URL)" value="${esc(cl && cl.link ? cl.link : '')}">
      <div class="picrow">${cl && imgOk(cl.img) ? imgTag(cl.img, 'thumb') : ''}
        <input data-i="sImg" placeholder="Picture: paste an image address…" value="${esc(cl && cl.img && !String(cl.img).startsWith('idb:') ? cl.img : '')}">
        <button class="small" data-a="imgUpload">Upload picture</button>${cl && cl.img ? '<button class="small warn" data-a="imgClear" title="Remove picture">✕</button>' : ''}</div>
      <div class="row tools">
        <button class="small" data-a="clueSwap" ${canSwap ? '' : 'disabled'} title="${canSwap ? 'Swap for a different clue from this category' : 'Hand-written set: swap the whole category, or use Find a clue'}">↻ Swap</button>
        <button class="small" data-a="clueMove" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move up (easier slot)">↑</button>
        <button class="small" data-a="clueMove" data-d="1" ${i === 4 ? 'disabled' : ''} title="Move down (harder slot)">↓</button>
        <button class="small warn" data-a="clueDel" ${cl ? '' : 'disabled'} title="Remove this clue">✕</button></div></div>`;
  }
  return `<div class="clue-card ${cl ? '' : 'empty'}" draggable="${cl ? 'true' : 'false'}" data-a="slot" data-c="${ci}" data-i="${i}" tabindex="0">
    <div class="row spread"><span class="v">${val}</span>${cl ? `<span class="tag d${cl.diff}">${DIFF[cl.diff]}</span>` : ''}</div>
    ${cl ? `<div class="q">${esc(cl.clue)}</div><div class="a">${esc(cl.answer)}</div>${safeLink(cl.link) ? '<div class="a">▶ has a clip</div>' : ''}${imgOk(cl.img) ? imgTag(cl.img, 'thumb') : ''}` : '<div class="q">Empty — click to write or fill</div>'}</div>`;
}
function vEditor() {
  const b = edit;
  const tabs = b.rounds.map((_, r) => `<button class="${tab === r ? 'on' : ''}" data-a="tab" data-t="${r}">${roundName(r)}</button>`).join('') +
    `<button class="${tab === 'final' ? 'on' : ''}" data-a="tab" data-t="final">Final</button>` +
    (b.rounds.length < 3 ? '<button class="small" data-a="addRound">＋ round</button>' : '') +
    (b.rounds.length > 1 ? '<button class="small warn" data-a="delRound">− last round</button>' : '');
  let body;
  if (tab === 'final') {
    body = `<div class="card" style="max-width:720px"><div class="row spread"><h3>Final wager clue</h3><button data-a="finalSwap">↻ Different final clue</button></div>
      <p><label>Category<br><input data-i="fTitle" value="${esc(b.final.title)}" style="width:100%"></label></p>
      <p><label>Clue<br><textarea rows="3" data-i="fClue">${esc(b.final.clue)}</textarea></label></p>
      <p><label>Correct response<br><input data-i="fAnswer" value="${esc(b.final.answer)}" style="width:100%"></label></p></div>`;
  } else {
    const rd = b.rounds[tab];
    const cols = rd.cats.map((c, ci) => `<div class="bcol">
        <input class="ctitle" data-i="cTitle" data-c="${ci}" value="${esc(c.title)}" aria-label="Category title">
        <div class="row tools"><button class="small" title="Swap in a different category" data-a="catSwap" data-c="${ci}">↻ New</button>
          <button class="small" title="Move left" data-a="catMove" data-c="${ci}" data-d="-1" ${ci === 0 ? 'disabled' : ''}>←</button>
          <button class="small" title="Move right" data-a="catMove" data-c="${ci}" data-d="1" ${ci === rd.cats.length - 1 ? 'disabled' : ''}>→</button>
          <button class="small warn" title="Remove category" data-a="catDel" data-c="${ci}">✕</button></div>
        ${c.clues.map((_, i) => clueCard(c, ci, i, tab)).join('')}</div>`).join('');
    const add = rd.cats.length < NCAT ? `<div class="bcol addcol"><button data-a="catAdd">＋ Add a category</button><button class="small" data-a="catBlank">＋ Blank category</button></div>` : '';
    body = `<div class="row" style="margin-bottom:10px"><button data-a="roundRegen">↻ New categories for this round</button>
        <span class="sub" style="margin:0">Click a clue to edit, swap, move or remove it. Drag one clue onto another to trade places.</span></div>
      <div class="board edit" style="--cols:${rd.cats.length + (add ? 1 : 0) || 1}">${cols}${add}</div>`;
  }
  const find = !showFind ? '' : `<div class="card find"><div class="row spread"><h3>Find a clue</h3><button class="small" data-a="toggleFind">Close</button></div>
      <div class="row"><input class="grow" data-i="sq" placeholder="Search every clue, e.g. christmas" value="${esc(search.q)}">
        <select data-i="skey"><option value="">All categories</option>${SRC.map(s => `<option value="${s.key}" ${s.key === search.key ? 'selected' : ''}>${s.kind === 'cur' ? '✍ ' : ''}${esc(s.title)}</option>`).join('')}</select>
        <select data-i="sdiff"><option value="">Any difficulty</option>${DIFF.map((d, i) => `<option value="${i}" ${String(i) === search.diff ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div id="results"></div></div>`;
  return `<div class="row spread edhead"><div class="row grow"><button data-a="home">← Boards</button>
        <input class="bname grow" data-i="bName" value="${esc(b.name)}" aria-label="Board name"></div>
      <div class="row"><button data-a="undo" ${hist.length ? '' : 'disabled'}>↶ Undo</button>
        <button class="${showOpts ? 'on' : ''}" data-a="toggleOpts">⚙ Mix settings</button>
        <button class="${showFind ? 'on' : ''}" data-a="toggleFind">🔍 Find a clue</button>
        <button class="primary" data-a="hostEdit">Host this board ▶</button></div></div>
    ${showOpts ? optsPanel() : ''}
    <div class="row tabs">${tabs}</div>${find}${body}`;
}
function runSearch() {
  const terms = search.q.toLowerCase().split(/\s+/).filter(Boolean);
  return BANK.filter(c => (search.key === '' || c.key === search.key) && (search.diff === '' || c.diff === +search.diff) && terms.every(t => c.hay.includes(t)));
}
function renderResults() {
  const el = document.getElementById('results');
  if (!el) return;
  const hits = runSearch();
  const canCat = tab !== 'final' && edit.rounds[tab].cats.length < NCAT && hits.length >= 5;
  el.innerHTML = `<div class="row spread" style="margin-top:8px"><span class="sub" style="margin:0">${hits.length.toLocaleString()} matches${hits.length > 60 ? ' (showing 60)' : ''}. "Use" fills the clue you have selected, or the first empty slot.</span>
      <button class="small" data-a="catFromSearch" ${canCat ? '' : 'disabled'}>＋ Make a category from these</button></div>
    <div class="results">${hits.slice(0, 60).map(c => `<div class="res"><div>${esc(c.clue)}</div><div class="a">${esc(c.answer)}</div>
      <div class="m"><span class="tag d${c.diff}">${DIFF[c.diff]}</span><span class="grow">${esc(SRCBY[c.key].title)}</span><button class="small" data-a="use" data-id="${c.id}">Use</button></div></div>`).join('')}</div>`;
}
function firstEmpty(rd) {
  for (let c = 0; c < rd.cats.length; c++) for (let i = 0; i < 5; i++) if (!rd.cats[c].clues[i]) return { c, i };
  return null;
}

// ---------- game ----------
function vSetup() {
  const b = boards.find(x => x.id === setup.boardId);
  return `<div class="row spread"><h1>Host: ${esc(b.name)}</h1><button data-a="home">← Back</button></div>
    ${boardSummary(b)}
    <div class="card" style="max-width:520px"><h3>Teams (2–5)</h3>
      ${setup.names.map((n, i) => `<p class="row"><input class="grow" data-i="tName" data-n="${i}" value="${esc(n)}">
        ${setup.names.length > 2 ? `<button class="small warn" data-a="tDel" data-n="${i}">✕</button>` : ''}</p>`).join('')}
      <p><label>Wildcards hidden in each round <select data-i="wildN">${[0, 1, 2, 3].map(n => `<option value="${n}" ${setup.wild === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></p>
      <div class="row">${setup.names.length < 5 ? '<button data-a="tAdd">＋ Add team</button>' : ''}
        <button class="primary big" data-a="start">Start game</button></div></div>
    <div class="card" style="max-width:520px"><h3>Guest screen</h3>
      <p class="sub" style="margin-bottom:10px">Open this page in a second window and press "Guest screen" on its home page (or add #screen to its address). Project or share that window: it follows your game and only shows a response once you reveal it.</p>
      <label class="check"><input type="checkbox" data-i="split" ${setup.split ? 'checked' : ''}> Show responses on this host screen. Untick if guests can see this window.</label></div>`;
}
function startGame(b, names) {
  const wild = b.rounds.map((rd, r) => {
    const cells = [];
    rd.cats.forEach((c, ci) => c.clues.forEach((cl, i) => { if (cl && i >= 1) cells.push(ci + '-' + i); }));
    return shuffle(cells).slice(0, setup.wild);
  });
  game = {
    board: clone(b), teams: names.map(n => ({ name: n.trim() || 'Team', score: 0 })),
    r: 0, used: {}, wild, open: null, phase: 'play', final: { stage: 0, wagers: [], right: [] }, split: !!setup.split,
  };
  store.set('tb.teams', names);
  saveGame(); fx.deal = true; go('play');
}
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
// responses show on the host's own screen only when asked for, and never while it is full screen
const showHost = () => !!game.split && !isFull();
function toggleFull() {
  const el = document.documentElement;
  try {
    if (isFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) throw new Error('unsupported');
    const p = req.call(el);
    if (p && p.catch) p.catch(() => ask("Full screen isn't available here. Use your browser's own full screen instead (F11, or Ctrl+Cmd+F on a Mac)."));
  } catch { ask("Full screen isn't available here. Use your browser's own full screen instead (F11, or Ctrl+Cmd+F on a Mac)."); }
}
const hasFinal = () => !!(game.board.final && game.board.final.clue);
const scoreBar = () => `<div class="scores" style="--n:${game.teams.length}">${game.teams.map((t, i) => `<div class="team ${fx.bump === i ? 'bump' : ''}"><div class="nm">${esc(t.name)}</div>
  <div class="sc ${t.score < 0 ? 'neg' : ''}" title="Click to adjust" data-a="adjust" data-n="${i}">${t.score.toLocaleString()}</div></div>`).join('')}</div>`;

function vPlay() {
  if (game.phase === 'final') return vFinal();
  if (game.phase === 'done') return vDone();
  const b = game.board, r = game.r, rd = b.rounds[r];
  const left = rd.cats.reduce((n, c, ci) => n + c.clues.filter((cl, i) => cl && !game.used[`${r}-${ci}-${i}`]).length, 0);
  const last = r === b.rounds.length - 1;
  const nextLabel = !last ? `Go to ${roundName(r + 1)} →` : hasFinal() ? 'Go to Final →' : 'Finish game →';
  const grid = `<div class="board ${fx.deal ? 'deal' : ''}" style="--cols:${rd.cats.length}">${rd.cats.map((c, ci) => `<div class="col"><div class="cat-head" style="--k:${ci}">${esc(c.title)}</div>
    ${c.clues.map((cl, i) => {
      const used = game.used[`${r}-${ci}-${i}`];
      return `<button class="cell ${!cl ? 'blank' : used ? 'used' : ''}" style="--k:${ci + i + 1}" ${!cl || used ? 'disabled' : ''} data-a="open" data-c="${ci}" data-i="${i}">${BASE[i] * (r + 1)}</button>`;
    }).join('')}</div>`).join('')}</div>`;
  const ctl = isScreen() ? '' : `<div class="row"><button class="${left ? '' : 'primary'}" data-a="nextRound">${nextLabel}</button>
        <button class="small ${game.split ? 'on' : ''}" data-a="toggleSplit" title="Show or hide responses on this screen (H)">${game.split ? 'Responses: shown here' : 'Responses: hidden'}</button>
        <button class="small" data-a="fullscreen" title="Full screen (F). Responses are always hidden on this screen while it is full screen.">⛶ Full screen</button>
        <button class="small" data-a="mute" title="Sound">${muted ? '🔇' : '🔊'}</button><button class="small" data-a="home">Exit</button></div>`;
  return `<div class="row spread playhead"><div><span class="rname">${roundName(r)}</span> <span class="sub">${esc(b.name)}</span></div>${ctl}</div>
    ${grid}${scoreBar()}${game.open ? vClue() : ''}`;
}
function vClue() {
  const o = game.open, r = game.r, cat = game.board.rounds[r].cats[o.c], cl = cat.clues[o.i];
  const val = o.wild ? o.wager : BASE[o.i] * (r + 1);
  const n = game.teams.length, pop = fx.pop ? 'pop' : '';
  if (isScreen()) {
    if (o.wild && o.stage === 'wager') return `<div class="overlay wildbg ${pop}"><div class="meta">${esc(cat.title)}</div><div class="wild">★ Wildcard ★</div>
      <p class="center note">${o.team == null ? 'Which team picked it?' : esc(game.teams[o.team].name) + ', how much will you risk?'}</p></div>`;
    return `<div class="overlay ${pop}"><div class="meta">${esc(cat.title)} · <b>${o.wild ? 'Wildcard ' : ''}${val.toLocaleString()}</b></div>
      ${imgTag(cl.img, 'clueimg')}<div class="clue">${esc(cl.clue)}</div>${clipWanted() ? '<div class="clipspace"></div>' : ''}<div class="answer">${o.show ? `<span class="shown">${esc(cl.answer)}</span>` : ''}</div>${scoreBar()}</div>`;
  }
  if (o.wild && o.stage === 'wager') {
    const max = o.team == null ? 0 : Math.max(game.teams[o.team].score, BASE[4] * (r + 1));
    return `<div class="overlay wildbg ${pop}"><div class="meta">${esc(cat.title)}</div><div class="wild">★ Wildcard ★</div>
      <p class="center sub">Only the team that picked this clue plays it. They choose how much to risk before seeing it.</p>
      <div class="judge" style="--n:${n}">${game.teams.map((t, i) => `<button class="team ${o.team === i ? 'picked on' : ''}" data-a="wTeam" data-n="${i}">
        <div class="nm">${esc(t.name)}</div><div>${t.score.toLocaleString()}</div></button>`).join('')}</div>
      <p class="center">${o.team == null ? 'Pick the team' : `<label>Wager (5 – ${max.toLocaleString()}) <input type="number" id="wager" min="5" max="${max}" step="5" value="${Math.min(o.wager || BASE[o.i] * (r + 1), max)}" style="width:140px;font-size:22px"></label>
        <button class="primary" data-a="wGo">Show clue</button>`}</p></div>`;
  }
  const teams = game.teams.map((t, i) => {
    if (o.wild && i !== o.team) return '';
    const missed = o.missed.includes(i);
    return `<div class="team"><div class="nm">${esc(t.name)}</div><div class="row">
      <button class="ok" data-a="right" data-n="${i}" ${missed || o.done ? 'disabled' : ''}>✓ +${val.toLocaleString()}</button>
      <button class="no" data-a="wrong" data-n="${i}" ${missed || o.done ? 'disabled' : ''}>✗ −${val.toLocaleString()}</button></div></div>`;
  }).join('');
  return `<div class="overlay ${pop}"><div class="row spread"><div class="meta">${esc(cat.title)} · <b>${o.wild ? 'Wildcard ' : ''}${val.toLocaleString()}</b></div>
      <button data-a="closeClue">${o.done ? 'Back to board' : 'No one — back to board'}</button></div>
    ${imgTag(cl.img, 'clueimg')}<div class="clue">${esc(cl.clue)}</div>
    ${clipControls(cl)}
    ${showHost() ? `<div class="hostbox"><span>Host only</span>${esc(cl.answer)}</div>` : ''}
    <div class="answer">${o.show ? (showHost() ? '<span class="note">Response is showing on the guest screen</span>' : `<span class="shown">${esc(cl.answer)}</span>`)
      : `<button data-a="reveal">${showHost() ? 'Show response on guest screen' : 'Reveal response'} (space)</button>`}</div>
    <div class="judge" style="--n:${o.wild ? 1 : n}">${teams}</div></div>`;
}
// ---------- clips ----------
// The video lives in one long-lived box outside #app, so re-rendering the page never restarts it.
// On the host screen it plays only when the host is the shared screen (responses hidden, or full screen);
// otherwise it plays on the guest screen and the host gets Play / Stop buttons.
const clipBox = document.createElement('div');
clipBox.className = 'clipbox'; clipBox.hidden = true; document.body.appendChild(clipBox);
let clipKey = '';
function clipWanted() {
  if (!game || game.phase !== 'play' || !game.open || !game.open.clip || !CAN_EMBED) return null;
  const cl = game.board.rounds[game.r].cats[game.open.c].clues[game.open.i];
  const yt = cl && ytInfo(cl.link);
  if (!yt) return null;
  if (!isScreen() && game.split && !isFull()) return null;      // the guest screen is playing it
  if (isScreen() && !guestReady) return null;
  return yt;
}
function placeClip() {
  const yt = clipWanted(), spot = yt && document.querySelector('.clipspace');
  if (!yt || !spot) { if (clipKey) { clipBox.innerHTML = ''; clipKey = ''; } clipBox.hidden = true; return; }
  const key = `${yt.id}:${yt.start}:${yt.end}:${game.open.clip}`;
  if (key !== clipKey) {
    clipKey = key;
    const q = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', modestbranding: '1' });
    if (yt.start) q.set('start', yt.start);
    if (yt.end) q.set('end', yt.end);
    clipBox.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yt.id}?${q}" title="Clip" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }
  const r = spot.getBoundingClientRect();
  Object.assign(clipBox.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
  clipBox.hidden = false;
}
window.addEventListener('resize', placeClip);
function clipControls(cl) {
  const link = safeLink(cl.link);
  if (!link) return '';
  const yt = ytInfo(link), o = game.open;
  const open = `<a class="cliplink" href="${esc(link)}" target="_blank" rel="noopener">${yt && CAN_EMBED ? 'Open on YouTube' : '▶ Play clip (opens a new tab)'}</a>`;
  if (!yt || !CAN_EMBED) return `<p class="center">${open}</p>`;
  const where = game.split && !isFull() ? ' on guest screen' : '';
  return `${clipWanted() ? '<div class="clipspace"></div>' : ''}<p class="center row" style="justify-content:center">
    <button class="cliplink" data-a="clipPlay">▶ ${o.clip ? 'Replay' : 'Play'} clip${where}</button>
    ${o.clip ? '<button data-a="clipStop">■ Stop clip</button>' : ''}${open}</p>`;
}

function closeClue() {
  const o = game.open; if (!o) return;
  game.used[`${game.r}-${o.c}-${o.i}`] = true; game.open = null; saveGame(); render();
}
function vFinal() {
  const f = game.board.final, st = game.final, n = game.teams.length;
  if (isScreen()) return `<div class="overlay ${fx.pop ? 'pop' : ''}"><div class="meta">Final wager · ${esc(f.title)}</div>
    ${st.stage === 0 ? `<div class="wild" style="font-size:clamp(24px,4vw,48px)">Final wager</div><div class="clue">${esc(f.title || 'Final')}</div><p class="center note">Write down your wagers.</p>`
      : `<div class="clue">${esc(f.clue)}</div><div class="answer">${st.stage >= 2 ? `<span class="shown">${esc(f.answer)}</span>` : ''}</div>`}${scoreBar()}</div>`;
  let body;
  if (st.stage === 0) {
    body = `<div class="wild" style="font-size:clamp(24px,4vw,48px)">Final wager</div><div class="clue" style="flex:0">${esc(f.title || 'Final')}</div>
      <p class="center sub">Every team with a positive score secretly writes down a wager up to its score. Enter them here, then show the clue.</p>
      <div class="judge" style="--n:${n}">${game.teams.map((t, i) => `<div class="team"><div class="nm">${esc(t.name)}</div><div>${t.score.toLocaleString()}</div>
        <input type="number" class="fw" data-n="${i}" min="0" max="${Math.max(t.score, 0)}" value="${st.wagers[i] ?? 0}" ${t.score <= 0 ? 'disabled' : ''} style="width:100%;margin-top:6px"></div>`).join('')}</div>
      <p class="center"><button class="primary big" data-a="fShow">Lock wagers &amp; show clue</button></p>`;
  } else {
    body = `<div class="clue">${esc(f.clue)}</div>
      ${showHost() ? `<div class="hostbox"><span>Host only</span>${esc(f.answer)}</div>` : ''}
      <div class="answer">${st.stage >= 2 ? (showHost() ? '<span class="note">Response is showing on the guest screen</span>' : `<span class="shown">${esc(f.answer)}</span>`)
        : `<button data-a="fReveal">${showHost() ? 'Show response on guest screen' : 'Reveal response'} (space)</button>`}</div>
      ${st.stage >= 2 ? `<div class="judge" style="--n:${n}">${game.teams.map((t, i) => `<div class="team"><div class="nm">${esc(t.name)}</div><div>wagered ${(st.wagers[i] || 0).toLocaleString()}</div>
        <div class="row"><button class="ok ${st.right[i] === true ? 'on' : ''}" data-a="fMark" data-n="${i}" data-v="1">✓</button>
        <button class="no ${st.right[i] === false ? 'on' : ''}" data-a="fMark" data-n="${i}" data-v="0">✗</button></div></div>`).join('')}</div>
        <p class="center"><button class="primary big" data-a="fDone">Apply &amp; show results</button></p>` : ''}`;
  }
  return `<div class="overlay ${fx.pop ? 'pop' : ''}"><div class="row spread"><div class="meta">Final wager · ${esc(f.title)}</div><button class="small" data-a="home">Exit</button></div>${body}</div>`;
}
function vDone() {
  const rank = [...game.teams].sort((a, b) => b.score - a.score);
  const top = rank[0].score, winners = rank.filter(t => t.score === top);
  return `<div class="center done"><div class="trophy">🏆</div><h1>${winners.map(t => esc(t.name)).join(' &amp; ')} win${winners.length > 1 ? '' : 's'}!</h1>
    <ol class="podium">${rank.map(t => `<li><span>${esc(t.name)}</span><b>${t.score.toLocaleString()}</b></li>`).join('')}</ol>
    ${isScreen() ? '' : '<p><button class="primary big" data-a="abandon">Done</button></p>'}</div>`;
}
let guestReady = false;     // a click on the guest screen lets its clips play with sound
function vScreen() {
  if (!guestReady) return `<div class="center waiting"><h1>Trivia <span>Board</span></h1>
    <p class="note">Guest screen</p><p><button class="primary big" data-a="guestStart">Click to start</button></p>
    <p class="sub">Starts full screen and lets video clips play with sound.</p></div>`;
  const exit = '<div class="exit-screen row"><button class="small" data-a="fullscreen">⛶ Full screen</button><button class="small" data-a="exitScreen">Exit guest screen</button></div>';
  if (!game) return `<div class="center waiting"><h1>Trivia <span>Board</span></h1><p class="note">Guest screen. Waiting for the host to start a game…</p></div>${exit}`;
  return vPlay() + exit;
}
// the guest screen re-reads the saved game whenever the host changes it
let lastRaw = null;
function syncScreen() {
  if (!isScreen()) return;
  let raw = null;
  try { raw = localStorage.getItem('tb.game'); } catch { /* storage unavailable */ }
  if (raw === lastRaw) return;
  const prev = game; lastRaw = raw;
  try { game = raw ? JSON.parse(raw) : null; } catch { game = null; }
  if (game) {
    const key = g => !g ? '' : g.phase === 'final' ? 'f' + g.final.stage : g.open ? `${g.r}-${g.open.c}-${g.open.i}-${g.open.stage}` : '';
    if (!prev || prev.r !== game.r || prev.board.id !== game.board.id || prev.teams.length !== game.teams.length) fx.deal = true;
    if (key(game) && key(game) !== key(prev)) fx.pop = true;
    if (prev && prev.teams.length === game.teams.length) fx.bump = game.teams.findIndex((t, i) => t.score !== prev.teams[i].score);
    if (game.phase === 'done' && (!prev || prev.phase !== 'done')) fx.confetti = true;
  }
  render();
}

// ---------- actions ----------
const A = {
  dlgNo() { dlg.hidden = true; dlgCb = null; },
  dlgYes() { const el = dlg.querySelector('#dlgIn'), v = el ? el.value : undefined, cb = dlgCb; dlg.hidden = true; dlgCb = null; if (cb) cb(v); },
  dlgFile() { A.dlgNo(); document.getElementById('importFile').click(); },
  home() { edit = null; go('home'); },
  goScreen() { location.hash = 'screen'; },
  guestStart() { guestReady = true; toggleFull(); render(); },
  clipPlay() { game.open.clip = (game.open.clip || 0) + 1; saveGame(); render(); },
  clipStop() { game.open.clip = 0; saveGame(); render(); },
  exitScreen() { location.hash = ''; },
  resume() { fx.deal = true; go('play'); },
  abandon() {
    const f = () => { game = null; saveGame(); go('home'); };
    if (game.phase === 'done') f(); else ask('Discard the game in progress?', f, { ok: 'Discard' });
  },
  openEditor(b) { edit = clone(b); hist = []; typing = false; tab = 0; sel = null; showFind = false; go('editor'); },
  newBoard() { const b = genBoard(); boards.unshift(b); saveBoards(); showOpts = false; A.openEditor(b); },
  usePreset(d) {
    const p = CUR.boards[+d.n], old = myCopy(p), b = fromPreset(p);
    if (!old) { boards.unshift(b); saveBoards(); A.openEditor(b); return; }
    ask(`Replace your copy of "${old.name}" with the latest version? Any edits you made to your copy will be lost.`, () => {
      b.id = old.id; boards[boards.indexOf(old)] = b; saveBoards(); A.openEditor(b);
    }, { ok: 'Replace' });
  },
  editBoard(d) { A.openEditor(boards.find(b => b.id === d.id)); },
  dupBoard(d) { const b = clone(boards.find(x => x.id === d.id)); b.id = uid(); b.name += ' (copy)'; boards.unshift(b); saveBoards(); render(); },
  delBoard(d) { const b = boards.find(x => x.id === d.id); ask(`Delete "${b.name}"?`, () => { boards = boards.filter(x => x !== b); saveBoards(); render(); }, { ok: 'Delete' }); },
  async exportBoard(d) {
    const b = await boardForExport(boards.find(x => x.id === d.id));
    exportText = JSON.stringify(b); exportName = (b.name || 'board').replace(/[^\w-]+/g, '_') + '.json';
    const big = exportText.length > 400000;
    ask(big ? 'This board has pictures, so the text is large. "Save as file" is the easiest way to keep it; open the file with "Import board" on any device.'
      : 'Copy this text and keep it somewhere safe. Paste it into "Import board" on any device to get the board back.', null,
      { area: big ? exportText.slice(0, 2000) + '…' : exportText, readonly: true, ok: big ? 'Close' : 'Copy & close', extra: '<button data-a="saveFile">Save as file</button>' });
    dlgCb = big ? null : () => { if (navigator.clipboard) navigator.clipboard.writeText(exportText).catch(() => {}); };
  },
  saveFile() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportText], { type: 'application/json' }));
    a.download = exportName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  imgUpload() { document.getElementById('imgFile').click(); },
  imgClear() { mut(() => { const cl = edit.rounds[tab].cats[sel.c].clues[sel.i]; if (cl) delete cl.img; }); },
  importBoard() {
    ask('Paste an exported board below, or choose a saved file.', v => { if (v && v.trim()) importText(v); },
      { area: '', ok: 'Import', extra: '<button data-a="dlgFile">Choose file…</button>' });
  },
  host(d) { setup.boardId = d.id; go('setup'); },
  hostEdit() { saveEdit(); setup.boardId = edit.id; edit = null; go('setup'); },

  // editor: settings
  toggleOpts() { showOpts = !showOpts; render(); },
  toggleFind() { showFind = !showFind; render(); },
  oTopic(d) { opts.topics = opts.topics.includes(d.t) ? opts.topics.filter(t => t !== d.t) : [...opts.topics, d.t]; store.set('tb.opts', opts); render(); },
  oAll() { opts.topics = [...TOPICS]; store.set('tb.opts', opts); render(); },
  regenAll() { mut(() => { edit = genBoard(edit.id, edit.name); tab = 0; sel = null; }); },
  undo() { if (!hist.length) return; edit = JSON.parse(hist.pop()); typing = false; sel = null; if (tab !== 'final' && !edit.rounds[tab]) tab = 0; saveEdit(); render(); },

  // editor: rounds and categories
  tab(d) { tab = d.t === 'final' ? 'final' : +d.t; sel = null; typing = false; render(); },
  addRound() { mut(() => { edit.rounds.push({ cats: [] }); tab = edit.rounds.length - 1; fillRound(edit, tab); sel = null; }); },
  delRound() { mut(() => { edit.rounds.pop(); tab = 0; sel = null; }); },
  roundRegen() { mut(() => { edit.rounds[tab].cats = []; fillRound(edit, tab); sel = null; }); },
  catAdd() { mut(() => { const cat = newCat(edit, tab); if (cat) edit.rounds[tab].cats.push(cat); }); },
  catBlank() { mut(() => { const cs = edit.rounds[tab].cats; cs.push({ title: 'New category', key: null, clues: [null, null, null, null, null] }); sel = { c: cs.length - 1, i: 0 }; }); },
  catSwap(d) { mut(() => { const cat = newCat(edit, tab); if (cat) edit.rounds[tab].cats[+d.c] = cat; sel = null; }); },
  catDel(d) { mut(() => { edit.rounds[tab].cats.splice(+d.c, 1); sel = null; }); },
  catMove(d) { mut(() => { const cs = edit.rounds[tab].cats, i = +d.c, j = i + +d.d; [cs[i], cs[j]] = [cs[j], cs[i]]; sel = null; }); },

  // editor: single clues
  slot(d) { sel = { c: +d.c, i: +d.i }; typing = false; render(); const t = document.querySelector('.clue-card.sel textarea'); if (t) t.focus(); },
  unsel() { sel = null; typing = false; render(); },
  clueSwap() {
    const cat = edit.rounds[tab].cats[sel.c], want = cat.clues[sel.i] ? cat.clues[sel.i].diff : profileFor(tab)[sel.i];
    const c = pickOne(cat.key, want, boardIds(edit));
    if (!c) { ask('No other clues left in this category.'); return; }
    mut(() => { cat.clues[sel.i] = slim(c); });
  },
  clueMove(d) { mut(() => { const cl = edit.rounds[tab].cats[sel.c].clues, j = sel.i + +d.d; [cl[sel.i], cl[j]] = [cl[j], cl[sel.i]]; sel = { c: sel.c, i: j }; }); },
  clueDel() { mut(() => { edit.rounds[tab].cats[sel.c].clues[sel.i] = null; }); },
  finalSwap() { mut(() => { edit.final = genFinal(edit, edit.final.clue); }); },
  use(d) {
    const c = BYID[d.id];
    if (tab === 'final') { mut(() => { edit.final = { title: SRCBY[c.key].title, clue: c.clue, answer: c.answer }; }); return; }
    const rd = edit.rounds[tab], at = sel && rd.cats[sel.c] ? sel : firstEmpty(rd);
    if (!at) { ask('Select the clue you want to replace first.'); return; }
    mut(() => { rd.cats[at.c].clues[at.i] = slim(c); sel = null; });
  },
  catFromSearch() {
    const hits = shuffle(runSearch()).slice(0, 5).sort((a, b) => a.diff - b.diff);
    const title = search.q.trim() || (search.key ? SRCBY[search.key].title : 'New category');
    mut(() => { edit.rounds[tab].cats.push({ title: title[0].toUpperCase() + title.slice(1), key: null, clues: hits.map(slim) }); sel = null; });
  },

  // game
  tAdd() { setup.names.push('Team ' + (setup.names.length + 1)); render(); },
  tDel(d) { setup.names.splice(+d.n, 1); render(); },
  start() {
    const b = boards.find(x => x.id === setup.boardId);
    if (!b.rounds.some(rd => rd.cats.some(c => filled(c)))) { ask('This board has no clues yet.'); return; }
    const f = () => startGame({ ...b, rounds: b.rounds.filter(rd => rd.cats.some(c => filled(c))) }, setup.names);
    if (game && game.phase !== 'done') ask('Starting a new game discards the one in progress. Continue?', f, { ok: 'Start new game' }); else f();
  },
  fullscreen() { toggleFull(); },
  toggleSplit() { game.split = !game.split; setup.split = game.split; store.set('tb.split', setup.split); saveGame(); render(); },
  mute() { muted = !muted; store.set('tb.mute', muted); render(); },
  open(d) {
    const c = +d.c, i = +d.i, wild = game.wild[game.r].includes(c + '-' + i);
    game.open = { c, i, wild, stage: wild ? 'wager' : 'clue', team: null, wager: 0, missed: [], show: false, done: false };
    sfx(wild ? 'wild' : 'open'); fx.pop = true; saveGame(); render();
  },
  wTeam(d) { game.open.team = +d.n; saveGame(); render(); },
  wGo() {
    const o = game.open, max = Math.max(game.teams[o.team].score, BASE[4] * (game.r + 1));
    o.wager = Math.max(5, Math.min(max, Math.round(+document.getElementById('wager').value || 0)));
    o.stage = 'clue'; sfx('open'); fx.pop = true; saveGame(); render();
  },
  reveal() { game.open.show = true; sfx('reveal'); saveGame(); render(); },
  right(d) {
    const o = game.open; game.teams[+d.n].score += o.wild ? o.wager : BASE[o.i] * (game.r + 1);
    o.done = true; o.show = true; sfx('right'); fx.bump = +d.n; saveGame(); render();
  },
  wrong(d) {
    const o = game.open; game.teams[+d.n].score -= o.wild ? o.wager : BASE[o.i] * (game.r + 1);
    o.missed.push(+d.n);
    if (o.wild || o.missed.length === game.teams.length) { o.done = true; o.show = true; }
    sfx('wrong'); fx.bump = +d.n; saveGame(); render();
  },
  closeClue,
  adjust(d) {
    const t = game.teams[+d.n];
    ask(`Set score for ${t.name}:`, v => { if (v.trim() !== '' && !isNaN(+v)) { t.score = Math.round(+v); saveGame(); render(); } }, { input: t.score });
  },
  nextRound() {
    const b = game.board;
    const left = b.rounds[game.r].cats.some((c, ci) => c.clues.some((cl, i) => cl && !game.used[`${game.r}-${ci}-${i}`]));
    const f = () => {
      if (game.r < b.rounds.length - 1) { game.r++; fx.deal = true; } else { game.phase = hasFinal() ? 'final' : 'done'; fx.pop = true; if (game.phase === 'done') { fx.confetti = true; sfx('win'); } else sfx('wild'); }
      saveGame(); render(); window.scrollTo(0, 0);
    };
    if (left) ask('There are unplayed clues in this round. Move on anyway?', f, { ok: 'Move on' }); else f();
  },
  fShow() {
    const st = game.final;
    document.querySelectorAll('.fw').forEach(el => {
      const i = +el.dataset.n, max = Math.max(game.teams[i].score, 0);
      st.wagers[i] = Math.max(0, Math.min(max, Math.round(+el.value || 0)));
    });
    st.stage = 1; sfx('open'); fx.pop = true; saveGame(); render();
  },
  fReveal() { game.final.stage = 2; sfx('reveal'); saveGame(); render(); },
  fMark(d) { game.final.right[+d.n] = d.v === '1'; saveGame(); render(); },
  fDone() {
    const st = game.final;
    game.teams.forEach((t, i) => { if (st.right[i] === true) t.score += st.wagers[i] || 0; else if (st.right[i] === false) t.score -= st.wagers[i] || 0; });
    game.phase = 'done'; fx.confetti = true; sfx('win'); saveGame(); render();
  },
};

// text inputs update the model in place (no re-render, so focus is kept)
function slotEdit(key, v) {
  touch();
  const cat = edit.rounds[tab].cats[sel.c];
  const cl = cat.clues[sel.i] || (cat.clues[sel.i] = { clue: '', answer: '', diff: ROWD[sel.i], id: 'x' + uid() });
  cl[key] = v; saveEdit();
}
const I = {
  oSource(v) { opts.source = v; store.set('tb.opts', opts); },
  oRounds(v) { opts.rounds = +v; store.set('tb.opts', opts); },
  oLevel(v) { opts.level = +v; store.set('tb.opts', opts); },
  bName(v) { touch(); edit.name = v; saveEdit(); },
  cTitle(v, d) { touch(); edit.rounds[tab].cats[+d.c].title = v; saveEdit(); },
  fTitle(v) { touch(); edit.final.title = v; saveEdit(); },
  fClue(v) { touch(); edit.final.clue = v; saveEdit(); },
  fAnswer(v) { touch(); edit.final.answer = v; saveEdit(); },
  sClue(v) { slotEdit('clue', v); },
  sAnswer(v) { slotEdit('answer', v); },
  sLink(v) { slotEdit('link', v.trim()); },
  sImg(v) { slotEdit('img', v.trim()); const t = document.querySelector('.clue-card.sel .picrow'); if (t && imgOk(v)) { const old = t.querySelector('img'); if (old) old.remove(); t.insertAdjacentHTML('afterbegin', imgTag(v, 'thumb')); } },
  sq(v) { search.q = v; renderResults(); },
  skey(v) { search.key = v; renderResults(); },
  sdiff(v) { search.diff = v; renderResults(); },
  tName(v, d) { setup.names[+d.n] = v; },
  wildN(v) { setup.wild = +v; store.set('tb.wild', setup.wild); },
  split(v, d, el) { setup.split = el.checked; store.set('tb.split', setup.split); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled || !A[el.dataset.a]) return;
  if (isScreen() && !['exitScreen', 'fullscreen', 'guestStart', 'dlgYes', 'dlgNo'].includes(el.dataset.a)) return;      // the guest screen is look-only
  A[el.dataset.a](el.dataset, el);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.i && I[el.dataset.i]) I[el.dataset.i](el.value, el.dataset, el);
});
document.addEventListener('keydown', e => {
  if (!dlg.hidden) {
    if (e.key === 'Escape') A.dlgNo();
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); A.dlgYes(); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && (isScreen() || view === 'play')) { toggleFull(); return; }
  if (isScreen()) return;
  if (view === 'play' && game && (e.key === 'h' || e.key === 'H') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { A.toggleSplit(); return; }
  if (view === 'editor' && e.key === 'Enter' && e.target.classList && e.target.classList.contains('clue-card')) { e.target.click(); return; }
  if (view !== 'play' || !game || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Space') {
    if (game.phase === 'final' && game.final.stage === 1) { e.preventDefault(); A.fReveal(); }
    else if (game.open && game.open.stage === 'clue' && !game.open.show) { e.preventDefault(); A.reveal(); }
  } else if (e.key === 'Escape' && game.phase === 'play' && game.open && game.open.stage === 'clue') closeClue();
});

// drag one clue onto another to trade places
let drag = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest && e.target.closest('.clue-card[data-c]');
  if (!el) return;
  drag = { c: +el.dataset.c, i: +el.dataset.i }; e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', 'clue'); } catch { /* ignore */ }
});
document.addEventListener('dragover', e => {
  const el = drag && e.target.closest && e.target.closest('.clue-card[data-c]');
  if (el) { e.preventDefault(); el.classList.add('over'); }
});
document.addEventListener('dragleave', e => { const el = e.target.closest && e.target.closest('.clue-card'); if (el) el.classList.remove('over'); });
document.addEventListener('drop', e => {
  const el = drag && e.target.closest && e.target.closest('.clue-card[data-c]');
  if (!el) { drag = null; return; }
  e.preventDefault();
  const a = drag, b = { c: +el.dataset.c, i: +el.dataset.i }; drag = null;
  if (a.c === b.c && a.i === b.i) return;
  mut(() => { const cs = edit.rounds[tab].cats, t = cs[a.c].clues[a.i]; cs[a.c].clues[a.i] = cs[b.c].clues[b.i]; cs[b.c].clues[b.i] = t; sel = null; });
});
document.addEventListener('dragend', () => { drag = null; });

document.getElementById('imgFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || !edit || !sel) return;
  try {
    const ref = await imgPut(await shrinkImage(file));
    mut(() => { slotEdit('img', ref); });
  } catch (err) { ask('Could not add that picture: ' + err.message); }
});
document.getElementById('importFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (file) importText(await file.text());
});

document.addEventListener('fullscreenchange', render);
document.addEventListener('webkitfullscreenchange', render);
window.addEventListener('storage', syncScreen);
setInterval(syncScreen, 400);
window.addEventListener('hashchange', () => { lastRaw = null; game = store.get('tb.game', null); if (!isScreen() && view === 'play' && !game) view = 'home'; render(); });
render();
})();
