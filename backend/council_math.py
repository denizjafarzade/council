"""Deterministic Chair maths (guide 2A): matrix, dissent and vote shifts are computed
in Python, never by the LLM."""

from statistics import pstdev

from schemas import COUNTRIES, SECTORS, MatrixCell, Vote, VoteShift

SCORE = {"bearish": -1.0, "neutral": 0.0, "bullish": 1.0}


def _view(score: float) -> str:
    if score > 0.33:
        return "bullish"
    if score < -0.33:
        return "bearish"
    return "neutral"


def compute_matrix(revotes: list[Vote], markets: list[str] = COUNTRIES,
                   sectors: list[str] = SECTORS, weights: dict[str, float] | None = None) -> list[MatrixCell]:
    """Confidence-weighted average of revotes per cell; dissent = spread of views (0..1).

    One seat, one vote: a market with several seats weighs each of them equally. `weights`
    (seat id -> 0..1, default 1) scales a seat's votes by how much of its evidence checked out.
    """
    out = []
    w = weights or {}
    for c in markets:
        for s in sectors:
            cells = [(cell, w.get(v.agent, 1.0)) for v in revotes for cell in v.cells if cell.country == c and cell.sector == s]
            if not cells:
                continue
            weight = sum(x.confidence * k for x, k in cells) or 1.0
            score = sum(SCORE[x.view] * x.confidence * k for x, k in cells) / weight
            view = _view(score)
            agreeing = [x.confidence * k for x, k in cells if x.view == view]
            confidence = (sum(agreeing) / sum(k for _, k in cells)) if agreeing else 0.0
            cells = [x for x, _ in cells]
            dissent = pstdev([SCORE[x.view] for x in cells]) if len(cells) > 1 else 0.0
            out.append(MatrixCell(
                country=c, sector=s, view=view,
                confidence=round(confidence, 2), dissent=round(min(dissent, 1.0), 2),
            ))
    return out


def compute_vote_shifts(blind: list[Vote], revotes: list[Vote]) -> list[VoteShift]:
    """Cells where an agent's view changed between the blind vote and the revote."""
    before = {(v.agent, x.country, x.sector): x.view for v in blind for x in v.cells}
    shifts = []
    for v in revotes:
        for x in v.cells:
            prev = before.get((v.agent, x.country, x.sector))
            if prev and prev != x.view:
                shifts.append(VoteShift(
                    agent=v.agent, cell=f"{x.country}/{x.sector}",
                    from_=prev, to=x.view, because=x.because or "no reason given",
                ))
    return shifts
