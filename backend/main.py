from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import alpaca_client as alpaca

app = FastAPI(title="Stocktrack")


class OrderRequest(BaseModel):
    symbol: str
    side: str  # "buy" or "sell"
    qty: float


@app.get("/api/account")
def account():
    return alpaca.get_account()


@app.get("/api/quote/{symbol}")
def quote(symbol: str):
    try:
        price = alpaca.get_latest_price(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Kunne ikke hente kurs for {symbol}: {e}")
    return {"symbol": symbol.upper(), "price": price}


@app.get("/api/positions")
def positions():
    return alpaca.get_positions()


@app.post("/api/orders")
def create_order(order: OrderRequest):
    if order.side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side skal være 'buy' eller 'sell'")
    if order.qty <= 0:
        raise HTTPException(status_code=400, detail="qty skal være positiv")
    try:
        return alpaca.place_market_order(order.symbol.upper(), order.side, order.qty)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/orders")
def orders():
    return alpaca.get_order_history()


frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
