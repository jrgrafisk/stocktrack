import os
from datetime import datetime, timedelta, timezone

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest, GetOrdersRequest, StopLossRequest
from alpaca.trading.enums import OrderSide, TimeInForce, QueryOrderStatus, OrderClass
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockLatestTradeRequest, StockBarsRequest
from alpaca.data.timeframe import TimeFrame
from alpaca.data.enums import DataFeed

# Free/paper accounts don't have a SIP subscription, which blocks querying
# recent data on the default feed — IEX is the always-available free feed.
FEED = DataFeed.IEX

MAX_LEVERAGE = 4  # matches Alpaca's paper account Reg-T margin multiplier
STOP_LOSS_FRACTION = 0.8  # auto-close once a position has lost 80% of its margin

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
    req = StockLatestTradeRequest(symbol_or_symbols=symbol, feed=FEED)
    trade = data_client.get_stock_latest_trade(req)[symbol]
    return float(trade.price)


def get_daily_bars(symbol: str, days: int = 2):
    """Used to find the previous close for the header's day-change figure."""
    start = datetime.now(timezone.utc) - timedelta(days=days * 2 + 10)
    req = StockBarsRequest(symbol_or_symbols=symbol, timeframe=TimeFrame.Day, start=start, feed=FEED)
    bars = data_client.get_stock_bars(req)[symbol][-days:]
    return [{"t": b.timestamp.isoformat(), "close": float(b.close)} for b in bars]


def get_minute_bars_for_day(symbol: str, day: str | None = None):
    """1-minute bars for a single trading day (YYYY-MM-DD). Defaults to the
    most recent day that has data (skips weekends/holidays automatically
    since Alpaca simply returns no bars for those days)."""
    if day:
        start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        # Free-tier data has a mandatory ~15 min delay: querying inside that
        # window is rejected outright rather than just delayed, so cap "today"
        # requests short of it. Past days are unaffected (already delayed).
        end = min(start + timedelta(days=1), now - timedelta(minutes=16))
        req = StockBarsRequest(symbol_or_symbols=symbol, timeframe=TimeFrame.Minute, start=start, end=end, feed=FEED)
        bars = data_client.get_stock_bars(req).data.get(symbol, [])
    else:
        # No explicit day: used by replay mode, which wants a *complete* past
        # session, so start from yesterday (today's day is still in progress
        # and belongs to live mode instead). Walk back day by day until a day
        # with bars turns up (handles weekends/holidays).
        cursor = datetime.now(timezone.utc) - timedelta(days=1)
        bars = []
        for _ in range(10):
            start = cursor.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
            req = StockBarsRequest(symbol_or_symbols=symbol, timeframe=TimeFrame.Minute, start=start, end=end, feed=FEED)
            bars = data_client.get_stock_bars(req).data.get(symbol, [])
            if bars:
                break
            cursor -= timedelta(days=1)

    return [
        {"t": b.timestamp.isoformat(), "o": float(b.open), "h": float(b.high), "l": float(b.low), "c": float(b.close)}
        for b in bars
    ]


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


def place_leveraged_order(symbol: str, direction: str, amount: float, leverage: int):
    """Opens a long or short position sized by `amount` (margin) x `leverage`
    (capped at Alpaca's own 4x Reg-T multiplier), with a native stop-loss
    order attached that closes the position once it has lost 80% of the
    margin put up — mirrors a leveraged CFD-style bet, but the entry, fill,
    and stop are all real Alpaca paper orders."""
    leverage = max(1, min(MAX_LEVERAGE, leverage))
    price = get_latest_price(symbol)
    qty = int((amount * leverage) / price)
    if qty < 1:
        raise ValueError("Beløbet er for lille til at købe/sælge en hel aktie ved denne kurs og gearing")

    is_long = direction == "long"
    order_side = OrderSide.BUY if is_long else OrderSide.SELL
    stop_fraction = STOP_LOSS_FRACTION / leverage
    stop_price = price * (1 - stop_fraction) if is_long else price * (1 + stop_fraction)

    order_data = MarketOrderRequest(
        symbol=symbol,
        qty=qty,
        side=order_side,
        time_in_force=TimeInForce.DAY,
        order_class=OrderClass.OTO,
        stop_loss=StopLossRequest(stop_price=round(stop_price, 2)),
    )
    order = trading_client.submit_order(order_data)
    return {
        "id": str(order.id),
        "symbol": order.symbol,
        "direction": direction,
        "qty": qty,
        "leverage": leverage,
        "entry_price": price,
        "stop_price": round(stop_price, 2),
        "status": order.status.value,
        "submitted_at": order.submitted_at.isoformat() if order.submitted_at else None,
    }


def close_position(symbol: str):
    # A leveraged position always has its stop-loss leg (OTO) still open,
    # which holds the shares and blocks a manual close — cancel it first.
    open_orders = trading_client.get_orders(GetOrdersRequest(status=QueryOrderStatus.OPEN, symbols=[symbol]))
    for o in open_orders:
        trading_client.cancel_order_by_id(o.id)

    order = trading_client.close_position(symbol)
    return {
        "id": str(order.id),
        "symbol": order.symbol,
        "status": order.status.value,
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
