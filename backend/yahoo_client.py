"""Data source for non-US tickers (e.g. Danish stocks like DANSKE.CO) that
Alpaca doesn't cover. Unlike a browser, a backend isn't subject to CORS, so
this hits Yahoo Finance's unofficial chart API directly — no proxy needed.
Data only: there's no broker behind this, so these symbols can only be
practiced in replay mode, never traded for real."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def is_yahoo_symbol(symbol: str) -> bool:
    return "." in symbol


def _fetch_chart(symbol: str, interval: str, rng: str):
    r = requests.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
        params={"interval": interval, "range": rng},
        headers=HEADERS,
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    result = (body.get("chart") or {}).get("result")
    if not result:
        err = (body.get("chart") or {}).get("error") or {}
        raise ValueError(err.get("description") or f"Ingen data for {symbol}")
    return result[0]


def _group_by_day(result):
    ts = result.get("timestamp") or []
    q = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    tz_name = (result.get("meta") or {}).get("exchangeTimezoneName", "UTC")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc

    opens, highs, lows, closes = q.get("open", []), q.get("high", []), q.get("low", []), q.get("close", [])
    days = {}
    for i, t in enumerate(ts):
        o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        if None in (o, h, l, c):
            continue
        day_key = datetime.fromtimestamp(t, tz).date().isoformat()
        days.setdefault(day_key, []).append({
            "t": datetime.fromtimestamp(t, timezone.utc).isoformat(),
            "o": round(o, 2), "h": round(h, 2), "l": round(l, 2), "c": round(c, 2),
        })
    return days


def get_quote(symbol: str):
    result = _fetch_chart(symbol, "1m", "1d")
    meta = result.get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        raise ValueError(f"Ingen kurs tilgængelig for {symbol}")
    prev_close = meta.get("chartPreviousClose") or meta.get("previousClose") or price
    change = price - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0.0
    return {
        "symbol": symbol,
        "price": round(price, 2),
        "prev_close": round(prev_close, 2),
        "change": round(change, 2),
        "change_pct": change_pct,
        "currency": meta.get("currency", "USD"),
        "name": meta.get("longName") or meta.get("shortName") or symbol,
    }


def get_minute_bars_for_day(symbol: str, day: str | None = None):
    result = _fetch_chart(symbol, "1m", "5d")
    days = _group_by_day(result)

    if day:
        return days.get(day, [])

    # No explicit day: replay mode wants a complete past session, so skip today.
    today = datetime.now(timezone.utc).date().isoformat()
    keys = sorted(k for k in days if k != today)
    return days[keys[-1]] if keys else []


def search(query: str):
    """Ticker/company search — covers every exchange Yahoo knows, so this is
    also how a plain US symbol (no suffix) turns up alongside the Danish
    .CO-suffixed ones: no need to know the right suffix ahead of time."""
    r = requests.get(
        "https://query1.finance.yahoo.com/v1/finance/search",
        params={"q": query, "quotesCount": 8, "newsCount": 0},
        headers=HEADERS,
        timeout=10,
    )
    r.raise_for_status()
    quotes = (r.json() or {}).get("quotes") or []
    return [
        {
            "symbol": q.get("symbol"),
            "name": q.get("shortname") or q.get("longname") or q.get("symbol"),
            "exchange": q.get("exchange"),
        }
        for q in quotes
        if q.get("quoteType") == "EQUITY" and q.get("symbol")
    ]
