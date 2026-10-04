"""Builds DataPacks (Contract 1) and writes data/cache/{country}.json.

Stage 0: ticker map + `--check` to verify every ticker returns data.
Stage 1B: build full DataPacks (series, sectors, macro, Google News RSS) here.

    python backend/data/fetch.py --check
"""

import argparse

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
        "rates": ("^TNX", "US 10Y Treasury yield"),
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
# HIBOR, LPR, BoJ rate and JGB yields are not on yfinance: fill them as `macro`
# values in Stage 1B (HKMA / PBoC / BoJ pages, or hardcode with a date).
# CSI 300 (000300.SS) returns only 1 day of history on yfinance, hence Shanghai Composite.
# Mainland markets are shut for Golden Week (1-7 Oct): CN data is as of 30 Sep.


def check() -> bool:
    import yfinance as yf

    ok = True
    print(f"{'country':8}{'role':12}{'ticker':12}{'last close':>14}  date        status")
    for country, roles in TICKERS.items():
        for role, (ticker, name) in roles.items():
            try:
                hist = yf.Ticker(ticker).history(period="1mo", auto_adjust=False)
                closes = hist["Close"].dropna()
            except Exception as e:  # noqa: BLE001 - report every failure, keep going
                closes, err = None, str(e)[:40]
            if closes is not None and len(closes) >= 15:
                print(f"{country:8}{role:12}{ticker:12}{closes.iloc[-1]:>14.2f}  {closes.index[-1]:%Y-%m-%d}  OK ({len(closes)} days)")
            else:
                ok = False
                detail = err if closes is None else f"only {len(closes)} days"
                print(f"{country:8}{role:12}{ticker:12}{'-':>14}  {'-':10}  FAIL {detail}")
    return ok


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="verify every ticker returns data")
    p.add_argument("--offline", action="store_true", help="never call the network; load from cache only")
    args = p.parse_args()
    if args.check:
        raise SystemExit(0 if check() else 1)
    raise SystemExit("DataPack build not implemented yet (Stage 1B). Use --check.")


if __name__ == "__main__":
    main()
