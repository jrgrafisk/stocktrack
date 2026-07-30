const fmtMoney = (n) => n.toLocaleString("da-DK", { style: "currency", currency: "USD" });

const symbolInput = document.getElementById("symbol-input");
const qtyInput = document.getElementById("qty-input");
const quoteDisplay = document.getElementById("quote-display");
const tradeForm = document.getElementById("trade-form");
const tradeMessage = document.getElementById("trade-message");

let quotePollTimer = null;

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || res.statusText);
  return body;
}

async function refreshAccount() {
  try {
    const acc = await fetchJSON("/api/account");
    document.getElementById("stat-cash").textContent = fmtMoney(acc.cash);
    document.getElementById("stat-equity").textContent = fmtMoney(acc.equity);
    document.getElementById("stat-buying-power").textContent = fmtMoney(acc.buying_power);
  } catch (e) {
    console.error("account fejl", e);
  }
}

async function refreshPositions() {
  const tbody = document.querySelector("#positions-table tbody");
  try {
    const positions = await fetchJSON("/api/positions");
    tbody.innerHTML = "";
    if (positions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Ingen beholdning endnu</td></tr>';
      return;
    }
    for (const p of positions) {
      const pl = p.unrealized_pl;
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${p.symbol}</td>
        <td>${p.qty}</td>
        <td>${fmtMoney(p.avg_entry_price)}</td>
        <td>${fmtMoney(p.current_price)}</td>
        <td>${fmtMoney(p.market_value)}</td>
        <td class="${pl >= 0 ? "pl-positive" : "pl-negative"}">${fmtMoney(pl)} (${p.unrealized_plpc >= 0 ? "+" : ""}${(p.unrealized_plpc * 100).toFixed(1)}%)</td>
      `;
      tbody.appendChild(row);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6">Fejl: ${e.message}</td></tr>`;
  }
}

async function refreshOrders() {
  const tbody = document.querySelector("#orders-table tbody");
  try {
    const orders = await fetchJSON("/api/orders");
    tbody.innerHTML = "";
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Ingen handler endnu</td></tr>';
      return;
    }
    for (const o of orders) {
      const row = document.createElement("tr");
      const time = o.submitted_at ? new Date(o.submitted_at).toLocaleString("da-DK") : "–";
      row.innerHTML = `
        <td>${time}</td>
        <td>${o.symbol}</td>
        <td>${o.side === "buy" ? "Køb" : "Salg"}</td>
        <td>${o.qty ?? "–"}</td>
        <td>${o.filled_avg_price ? fmtMoney(o.filled_avg_price) : "–"}</td>
        <td>${o.status}</td>
      `;
      tbody.appendChild(row);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6">Fejl: ${e.message}</td></tr>`;
  }
}

function refreshAll() {
  refreshAccount();
  refreshPositions();
  refreshOrders();
}

async function pollQuote() {
  const symbol = symbolInput.value.trim().toUpperCase();
  if (!symbol) {
    quoteDisplay.textContent = "–";
    return;
  }
  try {
    const q = await fetchJSON(`/api/quote/${encodeURIComponent(symbol)}`);
    quoteDisplay.textContent = fmtMoney(q.price);
  } catch (e) {
    quoteDisplay.textContent = "ukendt ticker";
  }
}

symbolInput.addEventListener("input", () => {
  clearTimeout(quotePollTimer);
  quotePollTimer = setTimeout(pollQuote, 400);
});

tradeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const side = e.submitter?.dataset.side;
  const symbol = symbolInput.value.trim().toUpperCase();
  const qty = Number(qtyInput.value);

  tradeMessage.textContent = "";
  tradeMessage.className = "message";

  if (!symbol || !qty || qty <= 0) return;

  const buttons = tradeForm.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));

  try {
    const order = await fetchJSON("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, side, qty }),
    });
    tradeMessage.textContent = `${side === "buy" ? "Købte" : "Solgte"} ${qty} stk. ${symbol} (status: ${order.status})`;
    tradeMessage.classList.add("success");
    qtyInput.value = "";
    refreshAll();
  } catch (err) {
    tradeMessage.textContent = err.message;
    tradeMessage.classList.add("error");
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});

refreshAll();
setInterval(refreshAll, 15000);
setInterval(pollQuote, 5000);
