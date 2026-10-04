"""Builds DataPacks (Contract 1) for HK, CN, US, JP and writes data/cache/{country}.json.

    python backend/data/fetch.py            # fetch everything, print a ticker table, write cache
    python backend/data/fetch.py --check    # only verify every ticker returns data
    python backend/data/fetch.py --offline  # no network: validate and summarise the cache

Ids are stable so agents can cite them: HK-idx, HK-fx, US-10y, HK-Tech, HK-hibor, HK-n3.
Never call the network during a demo: use --offline (the backend only reads the cache).
"""

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from schemas import COUNTRIES, SECTORS, DataPack  # noqa: E402

CACHE_DIR = Path(__file__).resolve().parent / "cache"
# Hand-entered rates for sources with no API (or when one is down). Only entries with a
# value are used; always fill as_of and source so agents can cite them honestly.
MANUAL_MACRO = Path(__file__).resolve().parent / "macro_manual.json"
UA = {"User-Agent": "Mozilla/5.0 (council hackathon data fetcher)"}

# One ticker per (country, role). Swap any that fail --check.
TICKERS: dict[str, dict[str, tuple[str, str]]] = {
    "HK": {
        "idx": ("^HSI", "Hang Seng Index"),
        "fx": ("HKD=X", "USD/HKD"),
        "Tech": ("3033.HK", "CSOP Hang Seng TECH ETF"),
        "Financials": ("0005.HK", "HSBC"),
        "Property": ("0016.HK", "Sun Hung Kai Properties"),
        "Energy": ("0883.HK", "CNOOC"),
    },
    "CN": {
        "idx": ("000001.SS", "Shanghai Composite"),
        "fx": ("CNY=X", "USD/CNY"),
        "Tech": ("688981.SS", "SMIC"),
        "Financials": ("601398.SS", "ICBC"),
        "Property": ("000002.SZ", "China Vanke"),
        "Energy": ("601857.SS", "PetroChina"),
    },
    "US": {
        "idx": ("^GSPC", "S&P 500"),
        "fx": ("DX-Y.NYB", "US Dollar Index"),
        "10y": ("^TNX", "US 10Y Treasury yield"),
        "Tech": ("XLK", "Technology Select Sector SPDR"),
        "Financials": ("XLF", "Financial Select Sector SPDR"),
        "Property": ("XLRE", "Real Estate Select Sector SPDR"),
        "Energy": ("XLE", "Energy Select Sector SPDR"),
    },
    "JP": {
        "idx": ("^N225", "Nikkei 225"),
        "fx": ("JPY=X", "USD/JPY"),
        "Tech": ("8035.T", "Tokyo Electron"),
        "Financials": ("8306.T", "Mitsubishi UFJ"),
        "Property": ("8801.T", "Mitsui Fudosan"),
        "Energy": ("5020.T", "ENEOS"),
    },
}
# CSI 300 (000300.SS) returns only 1 day of history on yfinance, hence Shanghai Composite.
# Mainland markets are shut for Golden Week (1-7 Oct): CN data is as of 30 Sep.

# Local market close, used for as_of. US is on EDT until early November.
CLOSE = {
    "HK": (16, timezone(timedelta(hours=8))),
    "CN": (15, timezone(timedelta(hours=8))),
    "US": (16, timezone(timedelta(hours=-4))),
    "JP": (15, timezone(timedelta(hours=9))),
}

# Market-focused queries; the guide's broader ones ("Hong Kong economy") pull in tourism and politics.
# Avoid bare "yuan" (people named Yuan) and "Nikkei" (the publisher Nikkei Asia).
NEWS_QUERY = {
    "HK": '"Hang Seng" OR "Hong Kong stocks" OR HIBOR OR "Hong Kong property"',
    "CN": '"China stocks" OR "Chinese stocks" OR PBoC OR "Shanghai Composite" OR "China property" OR "China stimulus" OR "yuan exchange rate"',
    "US": '"Federal Reserve" OR "Treasury yields" OR "S&P 500" OR "Fed rate"',
    "JP": '"Bank of Japan" OR "Japanese yen" OR "Nikkei 225" OR "Japanese stocks" OR "Japan bond yields"',
}
NEWS_PER_COUNTRY = 8

# Rates not on yfinance, from free official sources. Failures are skipped, never guessed.
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={}"
HKMA = ("https://api.hkma.gov.hk/public/market-data-and-statistics/daily-monetary-statistics/"
        "daily-figures-interbank-liquidity?pagesize=5&sortby=end_of_date&sortorder=desc")


def _library_market(country: str):
    """Markets beyond the four above (UK, IN, custom ones...) come from the market library."""
    import library

    m = library.markets().get(country)
    if m is None or "idx" not in m.tickers:
        raise KeyError(f"no tickers for market {country}")
    return m


def tickers_for(country: str) -> dict[str, tuple[str, str]]:
    return TICKERS[country] if country in TICKERS else {k: tuple(v) for k, v in _library_market(country).tickers.items()}


def close_for(country: str) -> tuple[int, int, timezone]:
    if country in CLOSE:
        hour, tz = CLOSE[country]
        return hour, 0, tz
    c = _library_market(country).close
    return (c.hour, c.minute, timezone(timedelta(hours=c.utc_offset))) if c else (16, 0, timezone.utc)


def news_query_for(country: str) -> str:
    return NEWS_QUERY.get(country) or _library_market(country).news_query or _library_market(country).name


# --- prices ------------------------------------------------------------------------

def history(ticker: str):
    import yfinance as yf

    closes = yf.Ticker(ticker).history(period="3mo", auto_adjust=False)["Close"].dropna()
    if len(closes) < 22:
        raise ValueError(f"only {len(closes)} days of history")
    return closes


def stats(closes) -> dict:
    """last, 1-day and 1-month (21 trading days) % change, 20-day annualised volatility %."""
    last = float(closes.iloc[-1])
    rets = closes.pct_change().dropna().iloc[-20:]
    return {
        "last": round(last, 4 if last < 20 else 2),
        "chg_1d_pct": round((last / float(closes.iloc[-2]) - 1) * 100, 2) + 0.0,  # + 0.0 turns -0.0 into 0.0
        "chg_1m_pct": round((last / float(closes.iloc[-22]) - 1) * 100, 2) + 0.0,
        "vol_20d_pct": round(float(rets.std()) * math.sqrt(252) * 100, 2),
        "date": closes.index[-1].date(),
    }


def fetch_prices(country: str, report: list) -> tuple[list, list, object]:
    series, sectors, idx_date = [], [], None
    for role, (ticker, name) in tickers_for(country).items():
        try:
            s = stats(history(ticker))
        except Exception as e:  # noqa: BLE001 - report every failure, keep going
            report.append((country, role, ticker, None, None, f"FAIL {str(e)[:50]}"))
            continue
        report.append((country, role, ticker, s["last"], s["date"], "OK"))
        date = s.pop("date")
        if role in SECTORS:
            sectors.append({"sector": role, "ticker": ticker,
                            "chg_1m_pct": s["chg_1m_pct"], "vol_20d_pct": s["vol_20d_pct"]})
        else:
            series.append({"id": f"{country}-{role}", "name": name, **s})
            if role == "idx":
                idx_date = date
    return series, sectors, idx_date


# --- macro -------------------------------------------------------------------------

def _get(url: str, timeout: int = 20) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def fred_latest(series_id: str) -> tuple[float, str]:
    rows = [line.split(",") for line in _get(FRED.format(series_id)).decode().splitlines()[1:]]
    rows = [(d, v) for d, v in rows if v not in (".", "")]
    date, value = rows[-1]
    return float(value), date


def fetch_macro(country: str, report: list) -> list:
    macro = []

    def add(mid: str, name: str, fn):
        try:
            value, date = fn()
            macro.append({"id": mid, "name": f"{name} (as of {date})", "value": round(value, 3)})
            report.append((country, "macro", mid, value, date, "OK"))
        except Exception as e:  # noqa: BLE001
            report.append((country, "macro", mid, None, None, f"FAIL {str(e)[:50]}"))

    if country == "HK":
        def hibor():
            rec = json.loads(_get(HKMA))["result"]["records"][0]
            return float(rec["hibor_fixing_1m"]), rec["end_of_date"]
        add("HK-hibor", "1M HIBOR", hibor)
    elif country == "US":
        add("US-ffr", "Effective Fed funds rate", lambda: fred_latest("DFF"))
    elif country == "JP":
        add("JP-10y", "JGB 10Y yield, monthly", lambda: fred_latest("IRLTLT01JPM156N"))
    return _with_fallbacks(country, macro, report)


def _with_fallbacks(country: str, macro: list, report: list) -> list:
    """Fill gaps from macro_manual.json, then from the previous cache. Never invent values."""
    have = {m["id"] for m in macro}
    manual = json.loads(MANUAL_MACRO.read_text(encoding="utf-8")) if MANUAL_MACRO.exists() else []
    for m in manual:
        if m["id"].startswith(f"{country}-") and m.get("value") is not None and m["id"] not in have:
            macro.append({"id": m["id"], "name": f"{m['name']} (as of {m['as_of']}, {m['source']})", "value": m["value"]})
            report.append((country, "macro", m["id"], m["value"], m["as_of"], "OK manual"))
            have.add(m["id"])
    cached = CACHE_DIR / f"{country}.json"
    if cached.exists():
        for m in json.loads(cached.read_text(encoding="utf-8")).get("macro", []):
            if m["id"] not in have:
                macro.append(m)
                report.append((country, "macro", m["id"], m["value"], None, "OK from previous cache"))
                have.add(m["id"])
    return macro


# --- news --------------------------------------------------------------------------

def fetch_news(country: str, report: list) -> list:
    query = news_query_for(country)
    q = urllib.parse.quote(query)
    url = f"https://news.google.com/rss/search?q={q}+when:7d&hl=en-US&gl=US&ceid=US:en"
    try:
        items = ET.fromstring(_get(url)).findall("./channel/item")
    except Exception as e:  # noqa: BLE001
        report.append((country, "news", query[:20], None, None, f"FAIL {str(e)[:50]}"))
        return []
    parsed = []
    for it in items:
        title = (it.findtext("title") or "").strip()
        source = (it.findtext("source") or "").strip()
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        try:
            published = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        parsed.append((published, title, source, it.findtext("link") or ""))
    parsed.sort(reverse=True)
    seen, unique = set(), []
    for item in parsed:  # the same wire story often appears under several outlets
        if item[1].lower() not in seen:
            seen.add(item[1].lower())
            unique.append(item)
    parsed = unique
    news = [{"id": f"{country}-n{i + 1}", "title": t, "source": s, "url": u,
             "published": p.isoformat(timespec="minutes")}
            for i, (p, t, s, u) in enumerate(parsed[:NEWS_PER_COUNTRY])]
    report.append((country, "news", query[:20], len(news), None, "OK" if news else "FAIL no items"))
    return news


# --- build -------------------------------------------------------------------------

def build(country: str, report: list) -> DataPack:
    series, sectors, idx_date = fetch_prices(country, report)
    hour, minute, tz = close_for(country)
    as_of = (datetime.combine(idx_date, datetime.min.time()).replace(hour=hour, minute=minute, tzinfo=tz)
             if idx_date else datetime.now(tz))
    return DataPack.model_validate({
        "country": country,
        "as_of": as_of.isoformat(),
        "series": series,
        "sectors": sectors,
        "macro": fetch_macro(country, report),
        "news": fetch_news(country, report),
        "coverage": "full" if len(sectors) == len(SECTORS) else "partial",
    })


def print_report(report: list) -> None:
    print(f"\n{'country':8}{'role':11}{'ticker / id':22}{'value':>12}  {'date':12}status")
    for country, role, ticker, value, date, status in report:
        v = "-" if value is None else (f"{value:.2f}" if isinstance(value, float) else str(value))
        print(f"{country:8}{role:11}{str(ticker)[:21]:22}{v:>12}  {str(date or '-'):12}{status}")


def load_cache(country: str) -> DataPack:
    return DataPack.model_validate_json((CACHE_DIR / f"{country}.json").read_text(encoding="utf-8"))


def summarise(pack: DataPack) -> str:
    return (f"{pack.country}: as_of {pack.as_of}, {len(pack.series)} series, {len(pack.sectors)} sectors, "
            f"{len(pack.macro)} macro, {len(pack.news)} headlines")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="only verify every ticker returns data")
    p.add_argument("--offline", action="store_true", help="never call the network; validate the cache")
    p.add_argument("countries", nargs="*", default=COUNTRIES)
    args = p.parse_args()

    if args.offline:
        for c in args.countries:
            print(summarise(load_cache(c)))
        return

    report: list = []
    if args.check:
        for c in args.countries:
            fetch_prices(c, report)
        print_report(report)
        raise SystemExit(0 if all(r[5] == "OK" for r in report) else 1)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    packs = []
    for c in args.countries:
        pack = build(c, report)
        (CACHE_DIR / f"{c}.json").write_text(json.dumps(pack.model_dump(), indent=2, ensure_ascii=False) + "\n",
                                            encoding="utf-8")
        packs.append(pack)
    print_report(report)
    print()
    for pack in packs:
        print(summarise(pack))
    failed = [r for r in report if r[5] != "OK"]
    if failed:
        print(f"\n{len(failed)} item(s) failed; packs were still written without them.")


if __name__ == "__main__":
    main()
