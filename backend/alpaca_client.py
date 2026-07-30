import os
from datetime import datetime, timedelta, timezone

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest, GetOrdersRequest
from alpaca.trading.enums import OrderSide, TimeInForce, QueryOrderStatus
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockLatestTradeRequest, StockBarsRequest
from alpaca.data.timeframe import TimeFrame

API_KEY = os.environ["ALPACA_API_KEY"]
SECRET_KEY = os.environ["ALPACA_SECRET_KEY"]

trading_client = TradingClient(API_KEY, SECRET_KEY, paper=True)
data_client = StockHistoricalDataClient(API_KEY, SECRET_KEY)


def get_account():
    account = trading_client.get_account()
    return {
        "cash": float(account.cash),
        "equity": float(account.equity),
        "buying_power": float(account.buying_power),
        "portfolio_value": float(account.portfolio_value),
    }


def get_latest_price(symbol: str) -> float:
    req = StockLatestTradeRequest(symbol_or_symbols=symbol)
    trade = data_client.get_stock_latest_trade(req)[symbol]
    return float(trade.price)


def get_daily_bars(symbol: str, days: int = 30):
    start = datetime.now(timezone.utc) - timedelta(days=days * 2 + 10)
    req = StockBarsRequest(symbol_or_symbols=symbol, timeframe=TimeFrame.Day, start=start)
    bars = data_client.get_stock_bars(req)[symbol][-days:]
    return [{"t": b.timestamp.isoformat(), "close": float(b.close)} for b in bars]


def get_quotes_with_change(symbols: list[str]):
    trades_req = StockLatestTradeRequest(symbol_or_symbols=symbols)
    trades = data_client.get_stock_latest_trade(trades_req)

    start = datetime.now(timezone.utc) - timedelta(days=14)
    bars_req = StockBarsRequest(symbol_or_symbols=symbols, timeframe=TimeFrame.Day, start=start)
    bars_map = data_client.get_stock_bars(bars_req)

    result = []
    for symbol in symbols:
        try:
            price = float(trades[symbol].price)
            bars = bars_map[symbol]
            prev_close = float(bars[-2].close) if len(bars) >= 2 else price
            change = price - prev_close
            change_pct = (change / prev_close * 100) if prev_close else 0.0
            result.append({
                "symbol": symbol,
                "price": price,
                "change": change,
                "change_pct": change_pct,
            })
        except Exception as e:
            result.append({"symbol": symbol, "error": str(e)})
    return result


def get_positions():
    positions = trading_client.get_all_positions()
    return [
        {
            "symbol": p.symbol,
            "qty": float(p.qty),
            "avg_entry_price": float(p.avg_entry_price),
            "current_price": float(p.current_price),
            "market_value": float(p.market_value),
            "unrealized_pl": float(p.unrealized_pl),
            "unrealized_plpc": float(p.unrealized_plpc),
        }
        for p in positions
    ]


def place_market_order(symbol: str, side: str, qty: float):
    order_side = OrderSide.BUY if side == "buy" else OrderSide.SELL
    order_data = MarketOrderRequest(
        symbol=symbol,
        qty=qty,
        side=order_side,
        time_in_force=TimeInForce.DAY,
    )
    order = trading_client.submit_order(order_data)
    return {
        "id": str(order.id),
        "symbol": order.symbol,
        "side": order.side.value,
        "qty": float(order.qty) if order.qty else None,
        "status": order.status.value,
        "submitted_at": order.submitted_at.isoformat() if order.submitted_at else None,
    }


def get_order_history(limit: int = 50):
    req = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=limit)
    orders = trading_client.get_orders(req)
    return [
        {
            "id": str(o.id),
            "symbol": o.symbol,
            "side": o.side.value,
            "qty": float(o.qty) if o.qty else None,
            "filled_avg_price": float(o.filled_avg_price) if o.filled_avg_price else None,
            "status": o.status.value,
            "submitted_at": o.submitted_at.isoformat() if o.submitted_at else None,
        }
        for o in orders
    ]
