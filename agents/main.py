import os
import asyncio
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional, Any

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Trade Coach Agent Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AGENTS_SECRET = os.environ.get("AGENTS_SECRET", "")
_executor = ThreadPoolExecutor(max_workers=2)

# ── Models ──────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    symbol: str
    date: Optional[str] = None

# ── Helpers ─────────────────────────────────────────────────────────────────

def _coerce_text(val: Any, limit: int = 4000) -> str:
    """Flatten any value (str, list of messages, dict) to a plain string."""
    if val is None:
        return ""
    if isinstance(val, str):
        return val[:limit]
    if isinstance(val, list):
        parts = []
        for item in val:
            if isinstance(item, dict):
                parts.append(item.get("content") or item.get("text") or str(item))
            else:
                parts.append(str(item))
        return "\n".join(parts)[:limit]
    return str(val)[:limit]


def _extract_sentiment_score(text: str) -> Optional[int]:
    """Try to parse a 0-100 sentiment score from the sentiment report text."""
    m = re.search(r"\b(\d{1,3})\s*(?:/\s*100|%|out of 100)", text, re.I)
    if m:
        v = int(m.group(1))
        return min(100, max(0, v))
    m = re.search(r"(?:score|sentiment)[^\d]{0,20}(\d{1,3})", text, re.I)
    if m:
        v = int(m.group(1))
        return min(100, max(0, v)) if v <= 100 else None
    return None


def _extract_rating(text: str) -> Optional[str]:
    """Extract Buy/Hold/Sell/Overweight/Underweight from decision text."""
    for keyword in ["Strong Buy", "Strong Sell", "Buy", "Sell", "Hold",
                    "Overweight", "Underweight", "Bearish", "Bullish"]:
        if re.search(rf"\b{keyword}\b", text, re.I):
            return keyword
    return None


def _extract_risk_profile(text: str) -> Optional[str]:
    """Map risk decision text to conservative/moderate/aggressive."""
    text_lower = text.lower()
    if any(w in text_lower for w in ["aggressive", "high risk", "higher risk", "larger position"]):
        return "aggressive"
    if any(w in text_lower for w in ["conservative", "low risk", "smaller position", "reduce"]):
        return "conservative"
    if any(w in text_lower for w in ["moderate", "balanced", "neutral", "standard"]):
        return "moderate"
    return None

# ── Core analysis (runs in thread pool) ─────────────────────────────────────

def _run_analysis(symbol: str, date: str) -> dict:
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.default_config import DEFAULT_CONFIG

    config = {
        **DEFAULT_CONFIG,
        "llm_provider": "anthropic",
        "deep_think_llm": "claude-sonnet-4-6",
        "quick_think_llm": "claude-haiku-4-5-20251001",
        "max_debate_rounds": 2,
        "max_risk_discuss_rounds": 2,
        "online_tools": False,
    }

    ta = TradingAgentsGraph(debug=False, config=config)
    state, decision = ta.propagate(symbol, date)

    if not isinstance(state, dict):
        state = dict(state) if state else {}

    # ── Analyst reports ──────────────────────────────────────────────────────
    market_report      = _coerce_text(state.get("market_report"))
    sentiment_report   = _coerce_text(state.get("sentiment_report"))
    news_report        = _coerce_text(state.get("news_report"))
    fundamentals_report = _coerce_text(state.get("fundamentals_report"))

    # ── Investment debate ────────────────────────────────────────────────────
    invest_state = state.get("investment_debate_state") or {}
    if not isinstance(invest_state, dict):
        try:
            invest_state = dict(invest_state)
        except Exception:
            invest_state = {}

    # Try multiple possible field names across TradingAgents versions
    bull_text  = _coerce_text(
        invest_state.get("bull_history") or
        invest_state.get("bull_argument") or
        invest_state.get("bull_perspective") or
        invest_state.get("bull_report") or ""
    )
    bear_text  = _coerce_text(
        invest_state.get("bear_history") or
        invest_state.get("bear_argument") or
        invest_state.get("bear_perspective") or
        invest_state.get("bear_report") or ""
    )
    research_decision = _coerce_text(
        invest_state.get("judge_decision") or
        invest_state.get("research_report") or
        invest_state.get("final_decision") or
        invest_state.get("recommendation") or ""
    )

    # ── Risk debate ──────────────────────────────────────────────────────────
    risk_state = state.get("risk_debate_state") or {}
    if not isinstance(risk_state, dict):
        try:
            risk_state = dict(risk_state)
        except Exception:
            risk_state = {}

    risk_aggressive = _coerce_text(
        risk_state.get("aggressive_history") or
        risk_state.get("aggressive_argument") or ""
    )
    risk_conservative = _coerce_text(
        risk_state.get("conservative_history") or
        risk_state.get("conservative_argument") or ""
    )
    risk_neutral = _coerce_text(
        risk_state.get("neutral_history") or
        risk_state.get("neutral_argument") or ""
    )
    risk_decision = _coerce_text(
        risk_state.get("judge_decision") or
        risk_state.get("risk_report") or
        risk_state.get("final_risk_decision") or ""
    )

    # ── Trader plan ──────────────────────────────────────────────────────────
    trader_plan = _coerce_text(
        state.get("trader_investment_plan") or
        state.get("trader_proposal") or ""
    )

    # ── Final decision ───────────────────────────────────────────────────────
    final_raw = (
        state.get("final_trade_decision") or
        state.get("portfolio_decision") or
        state.get("final_decision") or
        decision or ""
    )
    final_decision = _coerce_text(final_raw)

    # Try to extract price target from trader plan or final decision
    price_target = None
    for text in [trader_plan, final_decision]:
        m = re.search(r"(?:price target|target price)[^\d$]{0,15}\$?([\d,]+\.?\d*)", text, re.I)
        if m:
            try:
                price_target = float(m.group(1).replace(",", ""))
                break
            except ValueError:
                pass

    stop_loss = None
    for text in [trader_plan]:
        m = re.search(r"(?:stop[- ]loss|stop price)[^\d$]{0,15}\$?([\d,]+\.?\d*)", text, re.I)
        if m:
            try:
                stop_loss = float(m.group(1).replace(",", ""))
                break
            except ValueError:
                pass

    sentiment_score = _extract_sentiment_score(sentiment_report)
    rating = _extract_rating(final_decision) or _extract_rating(research_decision)
    risk_profile_rec = _extract_risk_profile(risk_decision)

    return {
        "symbol": symbol,
        "date": date,
        "market_report": market_report,
        "sentiment_report": sentiment_report,
        "sentiment_score": sentiment_score,
        "news_report": news_report,
        "fundamentals_report": fundamentals_report,
        "bull_argument": bull_text,
        "bear_argument": bear_text,
        "research_decision": research_decision,
        "risk_aggressive": risk_aggressive,
        "risk_conservative": risk_conservative,
        "risk_neutral": risk_neutral,
        "risk_decision": risk_decision,
        "risk_profile_recommendation": risk_profile_rec,
        "trader_plan": trader_plan,
        "final_decision": final_decision,
        "rating": rating,
        "price_target": price_target,
        "stop_loss": stop_loss,
    }

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/analyze")
async def analyze(
    req: AnalyzeRequest,
    x_agents_secret: Optional[str] = Header(None),
):
    if AGENTS_SECRET and x_agents_secret != AGENTS_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    date   = req.date or datetime.now().strftime("%Y-%m-%d")
    symbol = req.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    loop = asyncio.get_event_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(_executor, _run_analysis, symbol, date),
            timeout=240.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Analysis timed out after 4 minutes")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return result
