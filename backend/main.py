from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import alpaca_client as alpaca

app = FastAPI(title="Stocktrack")


class TradeRequest(BaseModel):
    symbol: str
    direction: str  # "long" or "short"
    amount: float
    leverage: int = 1


@app.get("/api/account")
def account():
    return alpaca.get_account()


@app.get("/api/quote/{symbol}")
def quote(symbol: str):
    symbol = symbol.upper()
    try:
        price = alpaca.get_latest_price(symbol)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Kunne ikke hente kurs for {symbol}: {e}")
    try:
        daily = alpaca.get_daily_bars(symbol, days=2)
        prev_close = daily[-2]["close"] if len(daily) >= 2 else price
    except Exception:
        prev_close = price
    change = price - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0.0
    return {"symbol": symbol, "price": price, "prev_close": prev_close, "change": change, "change_pct": change_pct}


@app.get("/api/replay/{symbol}")
def replay(symbol: str, day: str | None = None):
    try:
        bars = alpaca.get_minute_bars_for_day(symbol.upper(), day)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Kunne ikke hente historik for {symbol}: {e}")
    if not bars:
        raise HTTPException(status_code=404, detail=f"Ingen data for {symbol} den valgte dag")
    return bars


@app.get("/api/positions")
def positions():
    return alpaca.get_positions()


@app.post("/api/trade")
def trade(req: TradeRequest):
    if req.direction not in ("long", "short"):
        raise HTTPException(status_code=400, detail="direction skal være 'long' eller 'short'")
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="amount skal være positiv")
    try:
        return alpaca.place_leveraged_order(req.symbol.upper(), req.direction, req.amount, req.leverage)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/positions/{symbol}/close")
def close(symbol: str):
    try:
        return alpaca.close_position(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/orders")
def orders():
    return alpaca.get_order_history()


frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
