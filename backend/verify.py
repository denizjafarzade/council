"""Trust checks on what council members claim (Stage 3A).

1. Citations: every claim must cite source ids, and every id must exist in the data
   that member can see (its own market's DataPack, or all of them for cross-market seats).
   [EVENT], the run's news item, is valid for every seat.
2. Numbers: every number in a claim must match a value in the series it cites,
   allowing for rounding ("down 5%" matches a 1-month change of -5.29).

Each check returns plain-English problems; an empty list means the claim is verified.
"""

import re

from schemas import DataPack

# Text that looks numeric but is a label, not a data claim.
_BRACKETED = re.compile(r"\[[^\]]*\]")  # [HK-hibor, US-10y]
_SOURCE_ID = re.compile(r"\b[A-Z]{2,4}-[A-Za-z0-9]+\b")  # HK-n3, US-10y
_PERIOD = re.compile(r"\b\d+\s*-?\s*(?:days?|weeks?|months?|years?|yrs?|[dwmy])\b", re.I)  # 1-month, 20-day, 10y
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_QUARTER = re.compile(r"\b[HQ][1-4]\b")
_NUMBER = re.compile(r"(?<![A-Za-z\d.])([-+−]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|bp|bps|k)?(?![\d])", re.I)


def _values_by_id(pack: DataPack) -> dict[str, list[float]]:
    """Every number each source id stands for."""
    out: dict[str, list[float]] = {}
    for s in pack.series:
        out[s.id] = [s.last, s.chg_1d_pct, s.chg_1m_pct, s.vol_20d_pct]
    for s in pack.sectors:
        out[f"{pack.country}-{s.sector}"] = [s.chg_1m_pct, s.vol_20d_pct]
        if s.ticker:  # members often cite the proxy's ticker (XLK, 0016.HK); it is in the data too
            out[s.ticker] = [s.chg_1m_pct, s.vol_20d_pct]
    for m in pack.macro:
        out[m.id] = [m.value]
    for n in pack.news:
        out[n.id] = [v for v, _ in _numbers(n.title)]
    return out


def _label_numbers(packs: list[DataPack]) -> set[float]:
    """Numbers inside names ("S&P 500", "Nikkei 225", "Euro Stoxx 50") are labels, not claims."""
    names = [s.name for p in packs for s in p.series] + [s.ticker for p in packs for s in p.sectors]
    return {v for name in names for v, _ in _numbers(name)}


def _numbers(text: str) -> list[tuple[float, float]]:
    """(value, rounding tolerance) for each number in free text, ignoring ids, periods and years."""
    for pattern in (_BRACKETED, _SOURCE_ID, _PERIOD, _YEAR, _QUARTER):
        text = pattern.sub(" ", text)
    found = []
    for sign, whole, frac, unit in _NUMBER.findall(text):
        value = float(whole.replace(",", "") + (frac or ""))
        decimals = len(frac) - 1 if frac else 0
        tolerance = 0.5 * 10 ** -decimals + 1e-9
        if unit.lower() == "k":
            value, tolerance = value * 1000, tolerance * 1000
        found.append((-value if sign in "-−" and sign else value, tolerance))
    return found


def check_claim(text: str, source_ids: list[str], packs: list[DataPack], event: str = "",
                all_packs: list[DataPack] | None = None) -> list[str]:
    """Problems with one claim, given the DataPacks its author can see. [] = verified.

    `all_packs` (every market in the run) only supplies label numbers such as "S&P 500",
    which any member may name without citing.
    """
    known = {}
    for p in packs:
        known.update(_values_by_id(p))
    # Every seat may cite the news item the run is about; its numbers are the headline's.
    known["EVENT"] = [v for v, _ in _numbers(event)]
    problems = []
    if not source_ids:
        problems.append("cites no source")
    bad = [i for i in source_ids if i not in known]
    if bad:
        problems.append(f"{', '.join(bad)} not in this member's data")

    cited = [v for i in source_ids if i in known for v in known[i]]
    allowed = _label_numbers(all_packs or packs) | {v for v, _ in _numbers(event)}
    for value, tolerance in _numbers(text):
        if any(abs(abs(value) - a) <= tolerance for a in allowed):
            continue
        # Signs are often in words ("down 5%"), so compare magnitudes.
        if not any(abs(abs(value) - abs(c)) <= tolerance for c in cited):
            shown = f"{value:g}"
            problems.append(f"{shown} does not match any cited value" if cited else f"{shown} has no cited data")
    return problems
