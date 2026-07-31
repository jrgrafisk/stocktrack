// ======================================================
// SHARED HELPERS
// ======================================================
const moneyFmtCache = {};
function fmtMoney(v, currency = 'USD') {
  if (!moneyFmtCache[currency]) {
    moneyFmtCache[currency] = new Intl.NumberFormat('da-DK', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return moneyFmtCache[currency].format(v);
}
const CURRENCY_PREFIX = { USD: '$', DKK: 'kr ', EUR: '€' };
function fmtMoney0(v, currency = 'USD') {
  const sign = v < 0 ? '-' : '';
  const prefix = CURRENCY_PREFIX[currency] || currency + ' ';
  return sign + prefix + Math.round(Math.abs(v)).toLocaleString('da-DK');
}
const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const isYahooSymbol = (s) => s.includes('.');
const exchangeTZ = (s) => isYahooSymbol(s) ? 'Europe/Copenhagen' : 'America/New_York';

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || res.statusText);
  return body;
}

function notif(msg, type) {
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function fmtClock(ms, tz) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || 'America/New_York' }).format(new Date(ms));
}

// ======================================================
// STATE
// ======================================================
let mode = 'live';       // 'live' | 'replay'
let symbol = 'AAPL';

// Live mode
const live = { candles: [], price: null, prevClose: null, currency: 'USD', positions: [], refreshTimer: null };

// Replay mode: full day's candles plus a local practice ledger, exactly
// like a real account but disposable — reset on every "Genstart" or symbol
// change, so nobody has to worry about breaking anything real.
const MAX_LEVERAGE = 4;
const STOP_LOSS_FRACTION = 0.8;
let replayCandles = [];
let g = { balance: 10000, pnl: 0, wins: 0, losses: 0, idx: 0, positions: [], history: [], speed: 1000, paused: false, pid: 0, loop: null };

const symbolForm = document.getElementById('symbol-form');
const symbolInput = document.getElementById('symbol-input');
const amountInput = document.getElementById('amount');
const leverageInput = document.getElementById('leverage');

// ======================================================
// CANVAS CHART (shared by both modes)
// ======================================================
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const w = document.getElementById('chart-wrap');
  canvas.width = w.offsetWidth;
  canvas.height = w.offsetHeight;
}

function currentCandles() {
  if (mode === 'live') return live.candles;
  return replayCandles.slice(0, g.idx + 1);
}

function currentPositions() {
  return mode === 'live' ? live.positions : g.positions;
}

function drawChart() {
  const W = canvas.width, H = canvas.height;
  const bars = currentCandles();
  ctx.clearRect(0, 0, W, H);
  if (bars.length < 2) return;

  const visStart = Math.max(0, bars.length - 120);
  const visBars = bars.slice(visStart);
  const n = visBars.length;

  const allH = visBars.map(b => b.h);
  const allL = visBars.map(b => b.l);
  const maxP = Math.max(...allH) * 1.001;
  const minP = Math.min(...allL) * 0.999;
  const range = (maxP - minP) || 1;

  const padL = 8, padR = 56, padT = 12, padB = 6;
  const cW = W - padL - padR;
  const cH = H - padT - padB;
  const bw = Math.max(1.5, cW / n - 1);
  const px = (i) => padL + (i + 0.5) * (cW / n);
  const py = (v) => padT + cH - ((v - minP) / range) * cH;

  ctx.font = '9px IBM Plex Mono';
  for (let i = 0; i <= 5; i++) {
    const v = minP + (range * i / 5);
    const y = py(v);
    ctx.strokeStyle = 'rgba(21,30,53,0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(58,80,117,0.6)';
    ctx.textAlign = 'left';
    ctx.fillText(v.toFixed(2), W - padR + 3, y + 3);
  }

  visBars.forEach((bar, i) => {
    const x = px(i);
    const up = bar.c >= bar.o;
    const col = up ? '#17d490' : '#f03250';
    const bTop = py(Math.max(bar.o, bar.c));
    const bBot = py(Math.min(bar.o, bar.c));
    const bH = Math.max(1, bBot - bTop);

    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, py(bar.h)); ctx.lineTo(x, py(bar.l)); ctx.stroke();
    ctx.fillStyle = col;
    ctx.globalAlpha = up ? 0.9 : 0.75;
    ctx.fillRect(x - bw / 2, bTop, bw, bH);
    ctx.globalAlpha = 1;
  });

  currentPositions().forEach(p => {
    const entry = mode === 'live' ? p.avg_entry_price : p.entryPrice;
    const dir = mode === 'live' ? (p.qty >= 0 ? 'long' : 'short') : p.dir;
    const ey = py(entry);
    ctx.beginPath();
    ctx.strokeStyle = dir === 'long' ? 'rgba(23,212,144,0.45)' : 'rgba(240,50,80,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padL, ey); ctx.lineTo(W - padR, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = dir === 'long' ? '#17d490' : '#f03250';
    ctx.font = '9px IBM Plex Mono';
    ctx.textAlign = 'left';
    ctx.fillText(`${dir === 'long' ? '▲' : '▼'} ${entry.toFixed(2)}`, padL + 4, ey - 3);
  });

  ctx.textAlign = 'left';
}

window.addEventListener('resize', () => { resizeCanvas(); drawChart(); });

// ======================================================
// MODE SWITCH
// ======================================================
function setMode(m) {
  if (mode === m) return;
  clearInterval(live.refreshTimer); live.refreshTimer = null;
  clearInterval(g.loop); g.loop = null;
  document.querySelector('.end-screen')?.remove();

  mode = m;
  document.getElementById('mode-live').classList.toggle('active', m === 'live');
  document.getElementById('mode-replay').classList.toggle('active', m === 'replay');
  document.getElementById('controls').classList.toggle('hidden', m === 'live');

  if (m === 'live') loadLive(); else loadReplay();
}

symbolForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const s = symbolInput.value.trim().toUpperCase();
  if (!s) return;
  symbol = s;
  document.getElementById('asset-ticker').textContent = symbol;
  if (mode === 'live') loadLive(); else loadReplay();
});

// ======================================================
// LIVE MODE
// ======================================================
async function loadLive() {
  setStatus('Henter live-data …');
  try {
    const quote = await fetchJSON(`/api/quote/${symbol}`);
    live.price = quote.price;
    live.prevClose = quote.prev_close;
    live.currency = quote.currency || 'USD';
  } catch (e) {
    setStatus(`<span class="err">Kunne ikke hente ${esc(symbol)}: ${esc(e.message)}</span>`);
    return;
  }

  try {
    live.candles = await fetchJSON(`/api/replay/${symbol}?day=${todayStr()}`);
    setStatus('<span class="warn">Kurser er ca. 15 min. forsinkede (gratis data)</span>');
  } catch (e) {
    live.candles = [];
    setStatus('<span class="warn">Markedet er ikke åbnet endnu i dag — viser seneste kurs, ingen intradag-graf</span>');
  }

  document.getElementById('asset-ticker').textContent = symbol;
  renderLiveHeader();
  drawChart();
  refreshLiveAccountAndPositions();
  if (!live.refreshTimer) live.refreshTimer = setInterval(pollLive, 20000);
}

async function pollLive() {
  try {
    const quote = await fetchJSON(`/api/quote/${symbol}`);
    live.price = quote.price;
    live.prevClose = quote.prev_close;
    live.currency = quote.currency || 'USD';
    try { live.candles = await fetchJSON(`/api/replay/${symbol}?day=${todayStr()}`); } catch (e) { /* not open yet */ }
    renderLiveHeader();
    drawChart();
  } catch (e) { /* keep showing last known data */ }
  refreshLiveAccountAndPositions();
}

async function refreshLiveAccountAndPositions() {
  try {
    const [account, positions, orders] = await Promise.all([
      fetchJSON('/api/account'),
      fetchJSON('/api/positions'),
      fetchJSON('/api/orders'),
    ]);
    live.positions = positions;
    const openPl = positions.reduce((s, p) => s + p.unrealized_pl, 0);
    document.getElementById('hbal').textContent = fmtMoney0(account.equity, 'USD');
    const pnlEl = document.getElementById('hpnl');
    pnlEl.textContent = `${openPl >= 0 ? '+' : ''}${fmtMoney0(openPl, 'USD')}`;
    pnlEl.className = `hstat-value ${openPl >= 0 ? 'up' : 'dn'}`;
    document.getElementById('hwr').textContent = '–';
    document.getElementById('brand-sub').textContent = 'LIVE-HANDEL · ALPACA PAPER TRADING';

    renderPositionsLive(positions);
    renderHistoryLive(orders);
  } catch (e) { /* ignore transient failures */ }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function renderLiveHeader() {
  const price = live.price, prev = live.prevClose || price;
  const chg = price - prev, pct = prev ? (chg / prev * 100) : 0;
  const cur = live.currency;
  const tradable = !isYahooSymbol(symbol);

  document.getElementById('price-now').textContent = fmtMoney(price, cur);
  document.getElementById('price-now').className = `price-now ${chg >= 0 ? 'up' : 'dn'}`;
  document.getElementById('price-meta').textContent = `${chg >= 0 ? '+' : ''}${fmtMoney(chg, cur)} (${fmtPct(pct)}) vs. forrige luk`;
  document.getElementById('price-meta').className = `price-meta ${chg >= 0 ? 'up' : 'dn'}`;

  const bars = live.candles;
  if (bars.length) {
    document.getElementById('ks-open').textContent = fmtMoney(bars[0].o, cur);
    document.getElementById('ks-high').textContent = fmtMoney(Math.max(...bars.map(b => b.h)), cur);
    document.getElementById('ks-low').textContent = fmtMoney(Math.min(...bars.map(b => b.l)), cur);
    document.getElementById('clock').textContent = fmtClock(new Date(bars[bars.length - 1].t).getTime(), exchangeTZ(symbol));
    document.getElementById('candle-info').textContent = `${bars.length} min-stænger i dag`;
    document.getElementById('prog-fill').style.width = '100%';
  }
  document.getElementById('ks-prev').textContent = fmtMoney(prev, cur);
  document.getElementById('ks-close-label').textContent = 'SENESTE';
  document.getElementById('ks-close').textContent = fmtMoney(price, cur);
  document.getElementById('ks-chg').textContent = fmtPct(pct);
  document.getElementById('mkt-status').textContent = 'LIVE';
  document.getElementById('mkt-status').className = 'market-status open';
  document.getElementById('asset-full').textContent = tradable
    ? 'US-aktie · USD · Alpaca paper trading'
    : `${cur}-aktie · kun visning — brug Replay-træning for at handle`;
  amountInput.disabled = !tradable;
  document.querySelectorAll('.btn-long, .btn-short').forEach(b => b.disabled = !tradable);
  updateTradeInfo();
}

function renderPositionsLive(positions) {
  const el = document.getElementById('pos-list');
  if (!positions.length) { el.innerHTML = '<div class="empty-msg">Ingen åbne positioner</div>'; return; }
  el.innerHTML = positions.map(p => {
    const dir = p.qty >= 0 ? 'long' : 'short';
    const col = p.unrealized_pl >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div class="pos-card">
      <div class="pos-dir ${dir}">${dir.toUpperCase()}</div>
      <div class="pos-detail">
        <div class="sym">${esc(p.symbol)}</div>
        <div class="meta">@ ${fmtMoney(p.avg_entry_price, 'USD')} · ${Math.abs(p.qty)} stk.</div>
      </div>
      <div class="pos-pnl" style="color:${col}">${p.unrealized_pl >= 0 ? '+' : ''}${fmtMoney0(p.unrealized_pl, 'USD')}<br><span style="font-size:9px">${fmtPct(p.unrealized_plpc * 100)}</span></div>
      <button class="btn-x" onclick="closeLivePosition('${esc(p.symbol)}')">LUK</button>
    </div>`;
  }).join('');
}

function renderHistoryLive(orders) {
  const el = document.getElementById('hist-list');
  const filled = orders.filter(o => o.filled_avg_price != null);
  if (!filled.length) { el.innerHTML = '<div class="empty-msg">Ingen handler endnu</div>'; return; }
  el.innerHTML = filled.slice(0, 20).map(o => `
    <div class="hist-row">
      <span>${o.side === 'buy' ? 'LONG' : 'SHORT'} ${esc(o.symbol)} @ ${fmtMoney(o.filled_avg_price, 'USD')}</span>
      <span>${o.qty} stk. · ${esc(o.status)}</span>
    </div>
  `).join('');
}

async function closeLivePosition(sym) {
  try {
    await fetchJSON(`/api/positions/${sym}/close`, { method: 'POST' });
    notif(`Lukker ${sym} …`, 'info');
    setTimeout(refreshLiveAccountAndPositions, 1500);
  } catch (e) {
    notif(e.message, 'loss');
  }
}

// ======================================================
// REPLAY MODE
// ======================================================
let R = { open: null, prev: null, high: null, low: null, close: null, dayLabel: '', currency: 'USD' };

async function loadReplay() {
  setStatus('Henter historisk dag …');
  clearInterval(g.loop);
  document.querySelector('.end-screen')?.remove();
  amountInput.disabled = false;
  document.querySelectorAll('.btn-long, .btn-short').forEach(b => b.disabled = false);
  try {
    const [candles, quote] = await Promise.all([
      fetchJSON(`/api/replay/${symbol}`),
      fetchJSON(`/api/quote/${symbol}`).catch(() => ({ currency: isYahooSymbol(symbol) ? 'DKK' : 'USD' })),
    ]);
    replayCandles = candles;
    R.currency = quote.currency || 'USD';
    R.open = replayCandles[0].o;
    R.high = Math.max(...replayCandles.map(b => b.h));
    R.low = Math.min(...replayCandles.map(b => b.l));
    R.close = replayCandles[replayCandles.length - 1].c;
    R.dayLabel = new Date(replayCandles[0].t).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
    R.prev = R.open;

    g = { balance: 10000, pnl: 0, wins: 0, losses: 0, idx: 0, positions: [], history: [], speed: 1000, paused: false, pid: 0, loop: null };
    document.getElementById('asset-ticker').textContent = symbol;
    document.getElementById('brand-sub').textContent = 'REPLAY-TRÆNING · ' + R.dayLabel.toUpperCase();
    document.getElementById('asset-full').textContent = `Øvelseskonto · ${fmtMoney0(10000, R.currency)} · nulstilles hver session`;
    setStatus(`Genspiller ${esc(R.dayLabel)} · ${replayCandles.length} minutstænger`);
    renderReplayUI();
    drawChart();
    g.loop = setInterval(tick, g.speed);
  } catch (e) {
    setStatus(`<span class="err">Kunne ikke hente historik for ${esc(symbol)}: ${esc(e.message)}</span>`);
  }
}

function curPrice() { return replayCandles[g.idx].c; }

function tick() {
  if (g.paused) return;
  if (g.idx >= replayCandles.length - 1) {
    clearInterval(g.loop);
    autoCloseAllReplay();
    setTimeout(showEnd, 600);
    return;
  }
  g.idx++;
  checkStopLossReplay();
  renderReplayUI();
  drawChart();
}

function openTrade(direction) {
  const amount = parseFloat(amountInput.value);
  const leverage = parseInt(leverageInput.value);
  if (!amount || amount <= 0) { notif('Indtast et gyldigt beløb', 'info'); return; }

  if (mode === 'live') {
    fetchJSON('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, direction, amount, leverage }),
    }).then((order) => {
      notif(`${direction === 'long' ? '▲ LONG' : '▼ SHORT'} åbnet · ${order.qty} stk. @ ${fmtMoney(order.entry_price, 'USD')} · stop @ ${fmtMoney(order.stop_price, 'USD')}`, direction === 'long' ? 'win' : 'loss');
      setTimeout(refreshLiveAccountAndPositions, 1500);
    }).catch(e => notif(e.message, 'loss'));
    return;
  }

  // Replay: purely local, disposable ledger.
  if (amount > g.balance) { notif('Ikke nok kapital!', 'loss'); return; }
  if (g.idx >= replayCandles.length - 1) { notif('Dagen er slut!', 'info'); return; }
  const price = curPrice();
  g.positions.push({ id: ++g.pid, dir: direction, amount, leverage, entryPrice: price, openIdx: g.idx, exposure: amount * leverage });
  g.balance -= amount;
  notif(`${direction === 'long' ? '▲ LONG' : '▼ SHORT'} åbnet @ ${fmtMoney(price, R.currency)}`, direction === 'long' ? 'win' : 'loss');
  renderReplayUI();
  drawChart();
}

function calcPnLReplay(p) {
  const chg = (curPrice() - p.entryPrice) / p.entryPrice;
  return p.exposure * chg * (p.dir === 'long' ? 1 : -1);
}

function closePosReplay(id) {
  const idx = g.positions.findIndex(p => p.id === id);
  if (idx === -1) return;
  const p = g.positions[idx];
  const pnl = calcPnLReplay(p);
  g.balance += p.amount + pnl;
  g.balance = Math.max(0, g.balance);
  g.pnl += pnl;
  pnl >= 0 ? g.wins++ : g.losses++;
  g.history.unshift({ dir: p.dir, entry: p.entryPrice, exit: curPrice(), pnl });
  g.positions.splice(idx, 1);
  notif(`Lukket: ${pnl >= 0 ? '+' : ''}${fmtMoney0(pnl, R.currency)}`, pnl >= 0 ? 'win' : 'loss');
  renderReplayUI();
}

function checkStopLossReplay() {
  [...g.positions].forEach(p => {
    if (calcPnLReplay(p) / p.exposure <= -STOP_LOSS_FRACTION) {
      notif(`Stop-loss ramt! ${fmtMoney0(calcPnLReplay(p), R.currency)}`, 'loss');
      closePosReplay(p.id);
    }
  });
}

function autoCloseAllReplay() { [...g.positions].forEach(p => closePosReplay(p.id)); }

function renderReplayUI() {
  const price = curPrice();
  const prev = g.idx > 0 ? replayCandles[g.idx - 1].c : R.open;
  const chg = price - prev, pct = chg / prev * 100;
  const dayChg = price - R.open, dayPct = dayChg / R.open * 100;

  document.getElementById('price-now').textContent = fmtMoney(price, R.currency);
  document.getElementById('price-now').className = `price-now ${dayChg >= 0 ? 'up' : 'dn'}`;
  document.getElementById('price-meta').textContent = `${dayChg >= 0 ? '+' : ''}${fmtMoney(dayChg, R.currency)} (${fmtPct(dayPct)}) siden åbning`;
  document.getElementById('price-meta').className = `price-meta ${dayChg >= 0 ? 'up' : 'dn'}`;

  const seen = replayCandles.slice(0, g.idx + 1);
  document.getElementById('ks-open').textContent = fmtMoney(R.open, R.currency);
  document.getElementById('ks-prev').textContent = fmtMoney(R.prev, R.currency);
  document.getElementById('ks-high').textContent = fmtMoney(Math.max(...seen.map(b => b.h)), R.currency);
  document.getElementById('ks-low').textContent = fmtMoney(Math.min(...seen.map(b => b.l)), R.currency);
  document.getElementById('ks-close-label').textContent = 'AKTUEL';
  document.getElementById('ks-close').textContent = fmtMoney(price, R.currency);
  document.getElementById('ks-chg').textContent = fmtPct(dayPct);

  document.getElementById('clock').textContent = fmtClock(new Date(replayCandles[g.idx].t).getTime(), exchangeTZ(symbol));
  document.getElementById('prog-fill').style.width = `${(g.idx / (replayCandles.length - 1)) * 100}%`;
  document.getElementById('candle-info').textContent = `${g.idx + 1} / ${replayCandles.length}`;
  const statusEl = document.getElementById('mkt-status');
  if (g.idx >= replayCandles.length - 1) { statusEl.textContent = 'LUKKET'; statusEl.className = 'market-status closed'; }
  else { statusEl.textContent = 'ÅBENT'; statusEl.className = 'market-status open'; }

  document.getElementById('hbal').textContent = fmtMoney0(g.balance, R.currency);
  const pnlEl = document.getElementById('hpnl');
  pnlEl.textContent = `${g.pnl >= 0 ? '+' : ''}${fmtMoney0(g.pnl, R.currency)}`;
  pnlEl.className = `hstat-value ${g.pnl >= 0 ? 'up' : 'dn'}`;
  const tot = g.wins + g.losses;
  document.getElementById('hwr').textContent = tot > 0 ? Math.round(g.wins / tot * 100) + '%' : '–';

  const posEl = document.getElementById('pos-list');
  posEl.innerHTML = !g.positions.length ? '<div class="empty-msg">Ingen åbne positioner</div>' : g.positions.map(p => {
    const pnl = calcPnLReplay(p);
    const col = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div class="pos-card">
      <div class="pos-dir ${p.dir}">${p.dir.toUpperCase()}</div>
      <div class="pos-detail"><div class="sym">${esc(symbol)}</div><div class="meta">@ ${fmtMoney(p.entryPrice, R.currency)} · ${p.leverage}x · ${fmtMoney0(p.amount, R.currency)}</div></div>
      <div class="pos-pnl" style="color:${col}">${pnl >= 0 ? '+' : ''}${fmtMoney0(pnl, R.currency)}<br><span style="font-size:9px">${fmtPct(pnl / p.exposure * 100)}</span></div>
      <button class="btn-x" onclick="closePosReplay(${p.id})">LUK</button>
    </div>`;
  }).join('');

  const histEl = document.getElementById('hist-list');
  histEl.innerHTML = !g.history.length ? '<div class="empty-msg">Ingen handler endnu</div>' : g.history.slice(0, 20).map(h => `
    <div class="hist-row">
      <span>${h.dir.toUpperCase()} ${fmtMoney(h.entry, R.currency)} → ${fmtMoney(h.exit, R.currency)}</span>
      <span class="${h.pnl >= 0 ? 'win' : 'loss'}">${h.pnl >= 0 ? '+' : ''}${fmtMoney0(h.pnl, R.currency)}</span>
    </div>
  `).join('');

  updateTradeInfo();
}

function showEnd() {
  const final = Math.max(0, g.balance);
  const ret = (final - 10000) / 10000 * 100;
  const total = g.wins + g.losses;
  const wr = total > 0 ? Math.round(g.wins / total * 100) : 0;
  const isWin = final >= 10000;
  const dayRet = (R.close - R.open) / R.open * 100;

  const overlay = document.createElement('div');
  overlay.className = 'end-screen';
  overlay.innerHTML = `
    <h1 style="color:${isWin ? 'var(--green)' : 'var(--red)'}">${isWin ? 'PROFITABLE' : 'TABT'}</h1>
    <div class="sub">${esc(symbol)} · ${esc(R.dayLabel.toUpperCase())} · SESSION SLUT</div>
    <div class="final">${fmtMoney0(final, R.currency)}</div>
    <table>
      <tr><td>Afkast</td><td class="val" style="color:${isWin ? 'var(--green)' : 'var(--red)'}">${fmtPct(ret)}</td></tr>
      <tr><td>Wins</td><td class="val">${g.wins}</td></tr>
      <tr><td>Losses</td><td class="val">${g.losses}</td></tr>
      <tr><td>Win rate</td><td class="val">${wr}%</td></tr>
      <tr><td>Handler i alt</td><td class="val">${total}</td></tr>
    </table>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);margin-top:8px;">
      Faktisk udfald: ${esc(symbol)} åbnede ${fmtMoney(R.open, R.currency)} · lukkede ${fmtMoney(R.close, R.currency)} · ${fmtPct(dayRet)}
    </div>
    <button class="btn-again" onclick="loadReplay()">SPIL IGEN</button>
  `;
  document.body.appendChild(overlay);
}

// ======================================================
// SHARED CONTROLS
// ======================================================
function setSpeed(ms) {
  g.speed = ms;
  clearInterval(g.loop);
  if (!g.paused) g.loop = setInterval(tick, ms);
  const map = { 4000: '0.25x', 2000: '0.5x', 1000: '1x', 500: '2x', 200: '5x', 60: '15x' };
  const labels = { 4000: '4 min', 2000: '2 min', 1000: '1 minut', 500: '30 sek', 200: '12 sek', 60: '4 sek' };
  document.querySelectorAll('.ctrl-btn').forEach(b => {
    if (map[ms] && b.textContent === map[ms]) b.classList.add('active');
    else if (map[ms]) b.classList.remove('active');
  });
  const tl = document.getElementById('tempo-label');
  if (tl) tl.textContent = labels[ms] || '';
}

function togglePause() {
  g.paused = !g.paused;
  const btn = document.getElementById('pause-btn');
  if (g.paused) {
    clearInterval(g.loop);
    btn.textContent = '▶ Fortsæt';
    btn.classList.add('active');
  } else {
    g.loop = setInterval(tick, g.speed);
    btn.textContent = '⏸ Pause';
    btn.classList.remove('active');
  }
}

function seekTo(e) {
  if (mode === 'live') return;
  const x = e.offsetX / document.getElementById('prog-wrap').offsetWidth;
  g.idx = Math.max(0, Math.min(replayCandles.length - 1, Math.floor(x * (replayCandles.length - 1))));
  renderReplayUI();
  drawChart();
}

function setAmt(v) {
  amountInput.value = Math.max(1, Math.floor(v));
  updateTradeInfo();
}

function pct(p) {
  const balance = mode === 'live' ? 100000 : g.balance; // live buying power varies; a flat reference is enough for the quick-% buttons
  return balance * p / 100;
}

function updLev() {
  document.getElementById('lev-val').textContent = leverageInput.value + 'x';
  updateTradeInfo();
}

function updateTradeInfo() {
  const amt = parseFloat(amountInput.value) || 0;
  const lev = parseInt(leverageInput.value) || 1;
  const cur = mode === 'live' ? live.currency : R.currency;
  document.getElementById('ti-margin').textContent = fmtMoney0(amt, cur);
  document.getElementById('ti-exp').textContent = fmtMoney0(amt * lev, cur);
}

function setStatus(html) {
  document.getElementById('src-status').innerHTML = html;
}

amountInput.addEventListener('input', updateTradeInfo);

// ======================================================
// INIT
// ======================================================
resizeCanvas();
updateTradeInfo();
loadLive();
