import argparse
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

from alpha_generator_ollama import AlphaGenerator

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("paper_research.log"),
    ],
)
logger = logging.getLogger(__name__)

ARXIV_API_URL = "http://export.arxiv.org/api/query"
ARXIV_ABS_URL = "https://arxiv.org/abs/{paper_id}"
ARXIV_PDF_URL = "https://arxiv.org/pdf/{paper_id}.pdf"
DEFAULT_ARXIV_CATEGORIES = ["q-fin.PR", "q-fin.PM", "q-fin.RM"]
DEFAULT_LOOKBACK_YEARS = 3
DEFAULT_MAX_RESULTS = 1000
DEFAULT_PAPER_BUDGET = 10
DEFAULT_SCORE_THRESHOLD = 60.0
DEFAULT_PDF_DIR = "papers/raw"
DEFAULT_DB_PATH = "paper_research.db"
DEFAULT_FIELD_CACHE = "paper_data_fields_cache.json"
DEFAULT_TRACE_FILE = os.path.join("logs", "llm_trace.jsonl")
DEFAULT_FIELD_DATASETS = ["fundamental6", "fundamental2", "analyst4", "model16", "model51", "news12"]
FIELD_PAGE_SIZE = 50
FIELD_REQUEST_PAUSE_SECONDS = 0.35
FIELD_MAX_ROWS_PER_DATASET = {
    "fundamental6": 250,
    "fundamental2": 200,
    "analyst4": 200,
    "model16": 150,
    "model51": 150,
    "news12": 150,
}
EMPIRICAL_POSITIVE_KEYWORDS = {
    "cross-sectional": 4.0,
    "stock rank": 5.0,
    "factor investing": 5.0,
    "factor": 3.0,
    "anomaly": 4.0,
    "momentum": 3.0,
    "earnings": 4.0,
    "analyst": 4.0,
    "news": 4.0,
    "textual": 4.0,
    "liquidity": 3.0,
    "volatility": 3.0,
    "equity": 2.0,
    "stock": 2.0,
    "returns": 2.0,
    "mispricing": 4.0,
    "predict": 4.0,
    "forecast": 4.0,
    "alpha": 3.0,
    "signal": 3.0,
    "fundamental": 3.0,
    "quality": 3.0,
    "value": 3.0,
    "growth": 2.0,
    "empirical": 4.0,
    "dataset": 2.0,
    "backtest": 3.0,
}
THEORY_NEGATIVE_KEYWORDS = {
    "fokker": 6.0,
    "levy": 6.0,
    "asymptotic": 6.0,
    "tontine": 8.0,
    "insurance": 6.0,
    "cyber": 6.0,
    "recursive utility": 6.0,
    "wealth tax": 6.0,
    "taxation": 5.0,
    "portfolio choice": 3.0,
    "proof": 5.0,
    "theorem": 5.0,
    "diffusion": 4.0,
    "bates model": 6.0,
    "call-price": 6.0,
    "sir model": 6.0,
    "longevity": 6.0,
    "retirement": 5.0,
}
DOMAIN_HINT_TOKENS = {
    "analyst", "ibes", "estimate", "revision", "news", "sentiment", "textual",
    "price", "volume", "liquidity", "volatility", "momentum", "earnings",
    "fundamental", "book", "value", "growth", "quality", "profit", "margin",
    "revenue", "sales", "cash", "asset", "debt", "leverage", "beta", "risk",
    "accrual", "return", "returns", "forecast", "predict", "alpha", "factor",
}
MAPPING_NOISE_TOKENS = {
    "all", "non", "mean", "due", "during", "each", "final", "simple", "direct",
    "general", "current", "high", "low", "standard", "short", "long", "ratio",
    "score", "scores", "systematic", "period", "periods", "using", "based",
    "method", "methods", "framework", "approach", "ranking", "ranker", "rankers",
    "model", "models", "signal", "signals", "stock", "stocks", "portfolio",
    "factor", "factors", "alpha", "return", "returns", "predict", "prediction",
    "forecast", "forecasts", "uncertainty", "cross", "sectional", "safe", "deployment",
}
DATASET_HINTS = {
    "analyst4": {"analyst", "ibes", "estimate", "revision", "target", "forecast"},
    "news12": {"news", "textual", "sentiment", "headline", "media", "story", "price", "volume", "volatility"},
    "fundamental6": {"fundamental", "book", "value", "growth", "earnings", "revenue", "sales", "cash", "asset", "debt", "margin", "profit"},
    "fundamental2": {"fundamental", "book", "value", "growth", "earnings", "revenue", "sales", "cash", "asset", "debt", "margin", "profit"},
    "model16": {"quality", "momentum", "revision", "rank", "beta", "risk", "volatility", "value", "growth"},
    "model51": {"quality", "momentum", "revision", "rank", "beta", "risk", "volatility", "value", "growth"},
}
PREFERRED_FIELD_IDS_BY_TERM = {
    "news": ["news_indx_perf", "news_eps_actual", "news_eod_vwap", "news_curr_vol"],
    "textual": ["news_indx_perf", "news_eod_vwap", "news_curr_vol"],
    "price": ["news_indx_perf", "news_eod_close", "news_eod_vwap"],
    "volume": ["news_close_vol", "news_curr_vol", "news_eod_vwap"],
    "volatility": ["news_atr14", "news_atr_ratio", "systematic_risk_last_30_days"],
    "earnings": ["news_eps_actual", "actual_eps_value_quarterly", "earnings_certainty_rank_derivative"],
    "analyst": ["analyst_revision_rank_derivative", "actual_eps_value_quarterly", "anl4_ads1detailqfv110_estvalue"],
    "ibes": ["analyst_revision_rank_derivative", "actual_eps_value_quarterly", "anl4_ads1detailqfv110_estvalue"],
    "momentum": ["fscore_momentum", "fscore_bfl_momentum", "analyst_revision_rank_derivative"],
    "fundamental": ["bookvalue_ps", "fscore_value", "fscore_growth", "fscore_quality", "assets"],
    "value": ["bookvalue_ps", "fscore_value", "fscore_bfl_value", "enterprise_value"],
    "growth": ["fscore_growth", "fscore_bfl_growth", "actual_sales_value_quarterly"],
    "quality": ["fscore_quality", "fscore_bfl_quality", "earnings_certainty_rank_derivative"],
    "risk": ["systematic_risk_last_30_days", "news_atr14", "news_atr_ratio"],
    "liquidity": ["news_close_vol", "news_curr_vol", "news_eod_vwap"],
}
LLM_API_BASE = os.getenv("LLM_API_BASE", "https://coding.dashscope.aliyuncs.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3.5-plus")
STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "into", "using", "use",
    "risk", "return", "returns", "market", "asset", "assets", "paper", "model",
    "models", "stock", "stocks", "portfolio", "factor", "factors", "signal",
    "signals", "cross", "sectional", "time", "series", "based", "financial",
    "pricing", "premium", "premia", "alpha", "betas", "beta", "price", "prices",
}
PAPER_EXTRACTION_SYSTEM_PROMPT = (
    "You extract structured quantitative research ideas from finance papers. "
    "Return valid JSON only. Keep items concise, concrete, and implementation-oriented."
)
PAPER_TEMPLATE_SYSTEM_PROMPT = (
    "You are translating a finance paper idea into WorldQuant-style alpha templates. "
    "Return valid JSON only. Prefer unary/binary/ternary templates that can be expressed "
    "with standard daily equity operators. Do not invent unavailable datasets."
)
FIELD_MAPPING_SYSTEM_PROMPT = (
    "You map finance-paper variables to the most plausible WorldQuant Brain field ids. "
    "Return valid JSON only and do not guess with high confidence when overlap is weak."
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def sanitize_paper_id(paper_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", paper_id)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True)


def json_loads(value: Optional[str], default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", stripped)
        stripped = re.sub(r"\n?```$", "", stripped)
    return stripped.strip()


def extract_first_json_block(text: str) -> Optional[Any]:
    stripped = strip_code_fences(text)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for idx, char in enumerate(stripped):
        if char not in "[{":
            continue
        try:
            payload, _ = decoder.raw_decode(stripped[idx:])
            return payload
        except json.JSONDecodeError:
            continue
    return None


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def tokenize_text(text: str) -> List[str]:
    raw_tokens = re.findall(r"[A-Za-z_]{3,}", text.lower())
    tokens = []
    for token in raw_tokens:
        if token in STOPWORDS:
            continue
        token = re.sub(r"[^a-z_]", "", token)
        if len(token) >= 3:
            tokens.append(token)
    return tokens


def split_field_tokens(field_id: str) -> List[str]:
    tokens = []
    for chunk in re.split(r"[_\d]+", field_id.lower()):
        chunk = chunk.strip()
        if len(chunk) >= 3 and chunk not in STOPWORDS:
            tokens.append(chunk)
    return tokens


@dataclass
class PaperMeta:
    arxiv_id: str
    version: str
    title: str
    authors: List[str]
    summary: str
    categories: List[str]
    published_at: str
    abs_url: str
    pdf_url: str
    lane: str


@dataclass
class PaperCard:
    paper_id: int
    lane: str
    hypothesis: str
    formula_candidates: List[str]
    data_processing_steps: List[str]
    dataset_mentions: List[str]
    economic_mechanism: str
    implementation_notes: str
    parse_status: str
    implementability_score: float = 0.0


@dataclass
class FieldMapping:
    paper_id: int
    source_term: str
    mapped_field_id: str
    confidence: float
    rationale: str


@dataclass
class TemplateCard:
    paper_id: int
    arity: str
    preprocess_ops: List[str]
    comparison_pattern: str
    logic_ops: List[str]
    risk_control_ops: List[str]
    econ_thesis: str
    instantiation_rules: Dict[str, Any]
    expected_turnover_band: str
    expression_blueprint: str


class LLMClient:
    def __init__(self, trace_file: str = DEFAULT_TRACE_FILE):
        self.api_base = LLM_API_BASE
        self.model = LLM_MODEL
        self.api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("LLM_API_KEY")
        self.trace_file = trace_file
        ensure_dir(os.path.dirname(self.trace_file) or ".")

    def available(self) -> bool:
        return bool(self.api_key)

    def _log_exchange(
        self,
        *,
        phase: str,
        prompt: str,
        response_text: str,
        status_code: int,
        duration_seconds: float,
        paper_id: Optional[int] = None,
        template_id: Optional[int] = None,
        error: str = "",
    ) -> None:
        entry = {
            "timestamp": utc_now_iso(),
            "phase": phase,
            "paper_id": paper_id,
            "template_id": template_id,
            "model": self.model,
            "status_code": status_code,
            "duration_seconds": round(duration_seconds, 2),
            "prompt_hash": sha256_text(prompt),
            "response_hash": sha256_text(response_text),
            "error": error[:500],
        }
        try:
            with open(self.trace_file, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=True) + "\n")
        except Exception as exc:
            logger.warning("Could not write secure LLM trace: %s", exc)

    def complete_json(
        self,
        *,
        phase: str,
        system_prompt: str,
        user_prompt: str,
        paper_id: Optional[int] = None,
        template_id: Optional[int] = None,
        max_tokens: int = 1200,
    ) -> Optional[Any]:
        if not self.available():
            return None

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.1,
            "top_p": 0.9,
            "max_tokens": max_tokens,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        started_at = time.time()
        response_text = ""
        status_code = 0
        error = ""

        try:
            response = requests.post(
                f"{self.api_base}/chat/completions",
                headers=headers,
                json=payload,
                timeout=180,
            )
            status_code = response.status_code
            response_text = response.text
            if response.status_code != 200:
                error = response.text
                return None

            response_data = response.json()
            content = (
                response_data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            parsed = extract_first_json_block(content)
            if parsed is None:
                error = "invalid_json_payload"
            return parsed
        except Exception as exc:
            error = str(exc)
            return None
        finally:
            self._log_exchange(
                phase=phase,
                prompt=user_prompt,
                response_text=response_text,
                status_code=status_code,
                duration_seconds=time.time() - started_at,
                paper_id=paper_id,
                template_id=template_id,
                error=error,
            )


class PaperResearchDB:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS papers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    arxiv_id TEXT NOT NULL UNIQUE,
                    version TEXT,
                    title TEXT,
                    authors_json TEXT,
                    summary TEXT,
                    categories_json TEXT,
                    lane TEXT,
                    published_at TEXT,
                    abs_url TEXT,
                    pdf_url TEXT,
                    pdf_local_path TEXT,
                    status TEXT NOT NULL DEFAULT 'ingested',
                    parse_status TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS paper_cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    paper_id INTEGER NOT NULL UNIQUE,
                    lane TEXT,
                    hypothesis TEXT,
                    formula_candidates_json TEXT,
                    data_processing_steps_json TEXT,
                    dataset_mentions_json TEXT,
                    economic_mechanism TEXT,
                    implementation_notes TEXT,
                    parse_status TEXT,
                    implementability_score REAL NOT NULL DEFAULT 0,
                    score_breakdown_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (paper_id) REFERENCES papers(id)
                );

                CREATE TABLE IF NOT EXISTS field_mappings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    paper_id INTEGER NOT NULL,
                    source_term TEXT NOT NULL,
                    mapped_field_id TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    rationale TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(paper_id, source_term, mapped_field_id),
                    FOREIGN KEY (paper_id) REFERENCES papers(id)
                );

                CREATE TABLE IF NOT EXISTS template_cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    paper_id INTEGER NOT NULL,
                    template_index INTEGER NOT NULL,
                    arity TEXT,
                    preprocess_ops_json TEXT,
                    comparison_pattern TEXT,
                    logic_ops_json TEXT,
                    risk_control_ops_json TEXT,
                    econ_thesis TEXT,
                    instantiation_rules_json TEXT,
                    expected_turnover_band TEXT,
                    expression_blueprint TEXT,
                    status TEXT NOT NULL DEFAULT 'templated',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(paper_id, template_index),
                    FOREIGN KEY (paper_id) REFERENCES papers(id)
                );

                CREATE TABLE IF NOT EXISTS instantiation_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    template_card_id INTEGER NOT NULL,
                    expression TEXT NOT NULL UNIQUE,
                    field_bindings_json TEXT,
                    status TEXT NOT NULL DEFAULT 'instantiated',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (template_card_id) REFERENCES template_cards(id)
                );

                CREATE TABLE IF NOT EXISTS simulation_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    candidate_id INTEGER NOT NULL,
                    expression TEXT NOT NULL,
                    sharpe REAL,
                    fitness REAL,
                    turnover REAL,
                    returns REAL,
                    grade TEXT,
                    checks_json TEXT,
                    raw_result_json TEXT,
                    status TEXT NOT NULL DEFAULT 'simulated',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (candidate_id) REFERENCES instantiation_candidates(id)
                );

                CREATE TABLE IF NOT EXISTS mutation_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    simulation_run_id INTEGER NOT NULL UNIQUE,
                    reason TEXT,
                    priority REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'queued',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id)
                );
                """
            )

    def upsert_paper(self, paper: PaperMeta) -> int:
        now = utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO papers (
                    arxiv_id, version, title, authors_json, summary, categories_json,
                    lane, published_at, abs_url, pdf_url, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(arxiv_id) DO UPDATE SET
                    version=excluded.version,
                    title=excluded.title,
                    authors_json=excluded.authors_json,
                    summary=excluded.summary,
                    categories_json=excluded.categories_json,
                    lane=excluded.lane,
                    published_at=excluded.published_at,
                    abs_url=excluded.abs_url,
                    pdf_url=excluded.pdf_url,
                    updated_at=excluded.updated_at
                """,
                (
                    paper.arxiv_id,
                    paper.version,
                    paper.title,
                    json_dumps(paper.authors),
                    paper.summary,
                    json_dumps(paper.categories),
                    paper.lane,
                    paper.published_at,
                    paper.abs_url,
                    paper.pdf_url,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT id FROM papers WHERE arxiv_id = ?",
                (paper.arxiv_id,),
            ).fetchone()
            return int(row["id"])

    def update_paper_download(self, paper_id: int, pdf_local_path: Optional[str], status: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE papers
                SET pdf_local_path = ?, status = ?, updated_at = ?
                WHERE id = ?
                """,
                (pdf_local_path, status, utc_now_iso(), paper_id),
            )

    def update_paper_state(self, paper_id: int, status: str, parse_status: Optional[str] = None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE papers
                SET status = ?, parse_status = COALESCE(?, parse_status), updated_at = ?
                WHERE id = ?
                """,
                (status, parse_status, utc_now_iso(), paper_id),
            )

    def get_recent_unprocessed_papers(self, limit: int) -> List[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                """
                SELECT *
                FROM papers
                WHERE status IN ('ingested', 'downloaded', 'pdf_missing')
                ORDER BY published_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    def get_top_scored_papers(self, limit: int, score_threshold: float) -> List[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                """
                SELECT p.*, pc.implementability_score
                FROM papers p
                JOIN paper_cards pc ON pc.paper_id = p.id
                WHERE pc.implementability_score >= ?
                ORDER BY pc.implementability_score DESC, p.published_at DESC
                LIMIT ?
                """,
                (score_threshold, limit),
            ).fetchall()

    def get_untemplated_papers(self, limit: int, score_threshold: float) -> List[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                """
                SELECT p.*, pc.implementability_score
                FROM papers p
                JOIN paper_cards pc ON pc.paper_id = p.id
                LEFT JOIN template_cards tc ON tc.paper_id = p.id
                WHERE pc.implementability_score >= ? AND tc.id IS NULL
                ORDER BY pc.implementability_score DESC, p.published_at DESC
                LIMIT ?
                """,
                (score_threshold, limit),
            ).fetchall()

    def get_paper_card(self, paper_id: int) -> Optional[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                "SELECT * FROM paper_cards WHERE paper_id = ?",
                (paper_id,),
            ).fetchone()

    def upsert_paper_card(
        self,
        paper_id: int,
        card: PaperCard,
        score_breakdown: Dict[str, float],
    ) -> None:
        now = utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO paper_cards (
                    paper_id, lane, hypothesis, formula_candidates_json,
                    data_processing_steps_json, dataset_mentions_json,
                    economic_mechanism, implementation_notes, parse_status,
                    implementability_score, score_breakdown_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(paper_id) DO UPDATE SET
                    lane=excluded.lane,
                    hypothesis=excluded.hypothesis,
                    formula_candidates_json=excluded.formula_candidates_json,
                    data_processing_steps_json=excluded.data_processing_steps_json,
                    dataset_mentions_json=excluded.dataset_mentions_json,
                    economic_mechanism=excluded.economic_mechanism,
                    implementation_notes=excluded.implementation_notes,
                    parse_status=excluded.parse_status,
                    implementability_score=excluded.implementability_score,
                    score_breakdown_json=excluded.score_breakdown_json,
                    updated_at=excluded.updated_at
                """,
                (
                    paper_id,
                    card.lane,
                    card.hypothesis,
                    json_dumps(card.formula_candidates),
                    json_dumps(card.data_processing_steps),
                    json_dumps(card.dataset_mentions),
                    card.economic_mechanism,
                    card.implementation_notes,
                    card.parse_status,
                    card.implementability_score,
                    json_dumps(score_breakdown),
                    now,
                    now,
                ),
            )

    def replace_field_mappings(self, paper_id: int, mappings: List[FieldMapping]) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM field_mappings WHERE paper_id = ?", (paper_id,))
            for mapping in mappings:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO field_mappings (
                        paper_id, source_term, mapped_field_id, confidence, rationale, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        paper_id,
                        mapping.source_term,
                        mapping.mapped_field_id,
                        mapping.confidence,
                        mapping.rationale,
                        utc_now_iso(),
                    ),
                )

    def get_field_mappings(self, paper_id: int) -> List[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                """
                SELECT *
                FROM field_mappings
                WHERE paper_id = ?
                ORDER BY confidence DESC, mapped_field_id ASC
                """,
                (paper_id,),
            ).fetchall()

    def upsert_template_cards(self, paper_id: int, templates: List[TemplateCard]) -> List[int]:
        created_ids: List[int] = []
        now = utc_now_iso()
        with self._connect() as conn:
            for index, template in enumerate(templates, start=1):
                conn.execute(
                    """
                    INSERT INTO template_cards (
                        paper_id, template_index, arity, preprocess_ops_json,
                        comparison_pattern, logic_ops_json, risk_control_ops_json,
                        econ_thesis, instantiation_rules_json, expected_turnover_band,
                        expression_blueprint, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(paper_id, template_index) DO UPDATE SET
                        arity=excluded.arity,
                        preprocess_ops_json=excluded.preprocess_ops_json,
                        comparison_pattern=excluded.comparison_pattern,
                        logic_ops_json=excluded.logic_ops_json,
                        risk_control_ops_json=excluded.risk_control_ops_json,
                        econ_thesis=excluded.econ_thesis,
                        instantiation_rules_json=excluded.instantiation_rules_json,
                        expected_turnover_band=excluded.expected_turnover_band,
                        expression_blueprint=excluded.expression_blueprint,
                        updated_at=excluded.updated_at
                    """,
                    (
                        paper_id,
                        index,
                        template.arity,
                        json_dumps(template.preprocess_ops),
                        template.comparison_pattern,
                        json_dumps(template.logic_ops),
                        json_dumps(template.risk_control_ops),
                        template.econ_thesis,
                        json_dumps(template.instantiation_rules),
                        template.expected_turnover_band,
                        template.expression_blueprint,
                        now,
                        now,
                    ),
                )
                row = conn.execute(
                    """
                    SELECT id
                    FROM template_cards
                    WHERE paper_id = ? AND template_index = ?
                    """,
                    (paper_id, index),
                ).fetchone()
                created_ids.append(int(row["id"]))

        return created_ids

    def get_template_rows(self, paper_id: Optional[int] = None, limit: Optional[int] = None) -> List[sqlite3.Row]:
        query = "SELECT * FROM template_cards"
        params: List[Any] = []
        if paper_id is not None:
            query += " WHERE paper_id = ?"
            params.append(paper_id)
        query += " ORDER BY updated_at DESC"
        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)
        with self._connect() as conn:
            return conn.execute(query, tuple(params)).fetchall()

    def insert_candidate(self, template_card_id: int, expression: str, field_bindings: Dict[str, str]) -> int:
        now = utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO instantiation_candidates (
                    template_card_id, expression, field_bindings_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(expression) DO UPDATE SET
                    template_card_id=excluded.template_card_id,
                    field_bindings_json=excluded.field_bindings_json,
                    status='instantiated',
                    updated_at=excluded.updated_at
                """,
                (template_card_id, expression, json_dumps(field_bindings), now, now),
            )
            row = conn.execute(
                "SELECT id FROM instantiation_candidates WHERE expression = ?",
                (expression,),
            ).fetchone()
            return int(row["id"])

    def get_pending_candidates(self, limit: int) -> List[sqlite3.Row]:
        with self._connect() as conn:
            return conn.execute(
                """
                SELECT ic.*, tc.paper_id
                FROM instantiation_candidates ic
                JOIN template_cards tc ON tc.id = ic.template_card_id
                WHERE ic.status = 'instantiated'
                ORDER BY ic.updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    def mark_candidate_status(self, candidate_id: int, status: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE instantiation_candidates
                SET status = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, utc_now_iso(), candidate_id),
            )

    def insert_simulation_run(
        self,
        candidate_id: int,
        expression: str,
        sharpe: Optional[float],
        fitness: Optional[float],
        turnover: Optional[float],
        returns_value: Optional[float],
        grade: Optional[str],
        checks: List[Dict[str, Any]],
        raw_result: Dict[str, Any],
        status: str,
    ) -> int:
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO simulation_runs (
                    candidate_id, expression, sharpe, fitness, turnover, returns,
                    grade, checks_json, raw_result_json, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    candidate_id,
                    expression,
                    sharpe,
                    fitness,
                    turnover,
                    returns_value,
                    grade,
                    json_dumps(checks),
                    json_dumps(raw_result),
                    status,
                    utc_now_iso(),
                ),
            )
            return int(cursor.lastrowid)

    def enqueue_mutation(self, simulation_run_id: int, reason: str, priority: float) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO mutation_queue (
                    simulation_run_id, reason, priority, status, created_at
                ) VALUES (?, ?, ?, 'queued', ?)
                """,
                (simulation_run_id, reason, priority, utc_now_iso()),
            )

    def get_summary_counts(self) -> Dict[str, int]:
        tables = [
            "papers",
            "paper_cards",
            "template_cards",
            "instantiation_candidates",
            "simulation_runs",
            "mutation_queue",
        ]
        summary = {
            "papers": 0,
            "paper_cards": 0,
            "template_cards": 0,
            "instantiation_candidates": 0,
            "simulation_runs": 0,
            "mutation_queue": 0,
        }
        with self._connect() as conn:
            for table in tables:
                row = conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
                summary[table] = int(row["count"])
        return summary
class PaperResearchPipeline:
    def __init__(
        self,
        *,
        credentials_path: str,
        ollama_url: str,
        db_path: str,
        pdf_dir: str,
        categories: List[str],
        lookback_years: int,
        max_results: int,
        score_threshold: float,
        paper_budget: int,
        field_cache_path: str,
        max_concurrent: int,
    ):
        self.credentials_path = credentials_path
        self.ollama_url = ollama_url
        self.db = PaperResearchDB(db_path)
        self.pdf_dir = pdf_dir
        self.categories = categories or list(DEFAULT_ARXIV_CATEGORIES)
        self.lookback_years = max(1, lookback_years)
        self.max_results = max(1, max_results)
        self.score_threshold = score_threshold
        self.paper_budget = max(1, paper_budget)
        self.field_cache_path = field_cache_path
        self.max_concurrent = max(1, max_concurrent)
        self.llm = LLMClient()
        self._alpha_generator: Optional[AlphaGenerator] = None
        ensure_dir(self.pdf_dir)

    def _get_alpha_generator(self) -> AlphaGenerator:
        if self._alpha_generator is None:
            self._alpha_generator = AlphaGenerator(
                self.credentials_path,
                ollama_url=self.ollama_url,
                max_concurrent=self.max_concurrent,
            )
        return self._alpha_generator

    def _build_search_query(self) -> str:
        clauses = [f"cat:{category}" for category in self.categories]
        return " OR ".join(clauses)

    def _lookback_cutoff(self) -> datetime:
        return datetime.now(timezone.utc) - timedelta(days=365 * self.lookback_years)

    def sync_papers(self) -> int:
        logger.info("Syncing arXiv papers for categories: %s", ", ".join(self.categories))
        start = 0
        synced = 0
        cutoff = self._lookback_cutoff()
        namespace = {"atom": "http://www.w3.org/2005/Atom"}

        while start < self.max_results:
            batch_size = min(100, self.max_results - start)
            params = {
                "search_query": self._build_search_query(),
                "start": start,
                "max_results": batch_size,
                "sortBy": "submittedDate",
                "sortOrder": "descending",
            }
            response = requests.get(
                ARXIV_API_URL,
                params=params,
                timeout=60,
                headers={"User-Agent": "worldquant-paper-research/1.0"},
            )
            response.raise_for_status()
            root = ET.fromstring(response.text)
            entries = root.findall("atom:entry", namespace)
            if not entries:
                break

            reached_cutoff = False
            for entry in entries:
                paper = self._parse_arxiv_entry(entry, namespace)
                if paper is None:
                    continue
                try:
                    published_dt = datetime.fromisoformat(
                        paper.published_at.replace("Z", "+00:00")
                    )
                except ValueError:
                    published_dt = datetime.now(timezone.utc)
                if published_dt < cutoff:
                    reached_cutoff = True
                    break
                self.db.upsert_paper(paper)
                synced += 1

            if reached_cutoff or len(entries) < batch_size:
                break
            start += len(entries)

        logger.info("Synced %s papers from arXiv", synced)
        return synced

    def _parse_arxiv_entry(
        self, entry: ET.Element, namespace: Dict[str, str]
    ) -> Optional[PaperMeta]:
        entry_id = (entry.findtext("atom:id", default="", namespaces=namespace) or "").strip()
        if not entry_id:
            return None

        paper_id = entry_id.rsplit("/", 1)[-1]
        version_match = re.search(r"(v\d+)$", paper_id)
        version = version_match.group(1) if version_match else ""
        title = " ".join(
            (entry.findtext("atom:title", default="", namespaces=namespace) or "").split()
        )
        summary = " ".join(
            (entry.findtext("atom:summary", default="", namespaces=namespace) or "").split()
        )
        authors = [
            " ".join((author.findtext("atom:name", default="", namespaces=namespace) or "").split())
            for author in entry.findall("atom:author", namespace)
            if (author.findtext("atom:name", default="", namespaces=namespace) or "").strip()
        ]
        categories = [
            category.attrib.get("term", "").strip()
            for category in entry.findall("atom:category", namespace)
            if category.attrib.get("term", "").strip()
        ]
        published_at = (
            entry.findtext("atom:published", default="", namespaces=namespace) or utc_now_iso()
        ).strip()

        pdf_url = ""
        for link in entry.findall("atom:link", namespace):
            if link.attrib.get("title") == "pdf":
                pdf_url = link.attrib.get("href", "").strip()
                break
        if not pdf_url:
            pdf_url = ARXIV_PDF_URL.format(paper_id=paper_id)

        lane = "OTHER"
        for category in categories:
            if category in {"q-fin.PR", "q-fin.PM", "q-fin.RM"}:
                lane = category.split(".")[-1]
                break

        return PaperMeta(
            arxiv_id=paper_id,
            version=version,
            title=title,
            authors=authors,
            summary=summary,
            categories=categories,
            published_at=published_at,
            abs_url=ARXIV_ABS_URL.format(paper_id=paper_id),
            pdf_url=pdf_url,
            lane=lane,
        )

    def prepare_recent_papers(self, multiplier: int = 3) -> int:
        raw_limit = min(self.max_results, max(self.paper_budget * max(12, multiplier * 6), 80))
        candidate_rows = self.db.get_recent_unprocessed_papers(limit=raw_limit)
        rows = sorted(
            candidate_rows,
            key=lambda row: (self._metadata_empirical_score(row), str(row["published_at"] or "")),
            reverse=True,
        )[: self.paper_budget * max(1, multiplier)]
        processed = 0
        for row in rows:
            paper_id = int(row["id"])
            pdf_local_path = row["pdf_local_path"]
            if not pdf_local_path or not os.path.exists(pdf_local_path):
                pdf_local_path = self._download_pdf(row)
                if pdf_local_path:
                    self.db.update_paper_download(paper_id, pdf_local_path, "downloaded")
                else:
                    self.db.update_paper_download(paper_id, None, "pdf_missing")

            card = self.extract_paper_card(row, pdf_local_path)
            mappings = self.map_paper_to_fields(paper_id, row, card)
            score, breakdown = self.score_paper(row, card, mappings)
            card.implementability_score = score
            self.db.upsert_paper_card(paper_id, card, breakdown)
            self.db.replace_field_mappings(paper_id, mappings)
            self.db.update_paper_state(paper_id, "scored", card.parse_status)
            processed += 1

        logger.info("Prepared %s papers for scoring", processed)
        return processed

    def _metadata_empirical_score(self, paper_row: sqlite3.Row) -> float:
        text_blob = " ".join(
            [
                str(paper_row["title"] or ""),
                str(paper_row["summary"] or ""),
                str(paper_row["lane"] or ""),
            ]
        ).lower()
        score = 0.0
        for keyword, weight in EMPIRICAL_POSITIVE_KEYWORDS.items():
            if keyword in text_blob:
                score += weight
        for keyword, weight in THEORY_NEGATIVE_KEYWORDS.items():
            if keyword in text_blob:
                score -= weight
        return score

    def _download_pdf(self, paper_row: sqlite3.Row) -> Optional[str]:
        pdf_url = (paper_row["pdf_url"] or "").strip()
        if not pdf_url:
            return None

        paper_id = sanitize_paper_id(paper_row["arxiv_id"])
        local_path = os.path.join(self.pdf_dir, f"{paper_id}.pdf")
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            return local_path

        try:
            response = requests.get(
                pdf_url,
                timeout=90,
                headers={"User-Agent": "worldquant-paper-research/1.0"},
            )
            response.raise_for_status()
            with open(local_path, "wb") as handle:
                handle.write(response.content)
            return local_path
        except Exception as exc:
            logger.warning("Could not download PDF for %s: %s", paper_row["arxiv_id"], exc)
            return None

    def extract_paper_card(self, paper_row: sqlite3.Row, pdf_local_path: Optional[str]) -> PaperCard:
        paper_id = int(paper_row["id"])
        body_text = self._extract_pdf_text(pdf_local_path)
        parse_status = "parsed" if body_text else "degraded"
        fallback = self._fallback_extract_from_text(
            summary=paper_row["summary"] or "",
            body_text=body_text or "",
            lane=paper_row["lane"] or "OTHER",
        )

        if body_text and self.llm.available():
            prompt = (
                "Extract a concise implementation card from the finance paper text below.\n"
                "Return JSON with keys: hypothesis, formula_candidates, data_processing_steps, "
                "dataset_mentions, economic_mechanism, implementation_notes.\n\n"
                f"Title: {paper_row['title']}\n"
                f"Lane: {paper_row['lane']}\n"
                f"Abstract: {paper_row['summary']}\n\n"
                f"Paper text excerpt:\n{body_text[:24000]}"
            )
            parsed = self.llm.complete_json(
                phase="paper_extract",
                system_prompt=PAPER_EXTRACTION_SYSTEM_PROMPT,
                user_prompt=prompt,
                paper_id=paper_id,
                max_tokens=1200,
            )
            if isinstance(parsed, dict):
                hypothesis = (parsed.get("hypothesis") or fallback["hypothesis"]).strip()
                economic_mechanism = (
                    parsed.get("economic_mechanism") or fallback["economic_mechanism"]
                ).strip()
                implementation_notes = (
                    parsed.get("implementation_notes") or fallback["implementation_notes"]
                ).strip()
                return PaperCard(
                    paper_id=paper_id,
                    lane=paper_row["lane"] or "OTHER",
                    hypothesis=hypothesis,
                    formula_candidates=self._normalize_list(
                        parsed.get("formula_candidates"), limit=6
                    ) or fallback["formula_candidates"],
                    data_processing_steps=self._normalize_list(
                        parsed.get("data_processing_steps"), limit=8
                    ) or fallback["data_processing_steps"],
                    dataset_mentions=self._normalize_list(
                        parsed.get("dataset_mentions"), limit=8
                    ) or fallback["dataset_mentions"],
                    economic_mechanism=economic_mechanism,
                    implementation_notes=implementation_notes,
                    parse_status=parse_status,
                )

        return PaperCard(
            paper_id=paper_id,
            lane=paper_row["lane"] or "OTHER",
            hypothesis=fallback["hypothesis"],
            formula_candidates=fallback["formula_candidates"],
            data_processing_steps=fallback["data_processing_steps"],
            dataset_mentions=fallback["dataset_mentions"],
            economic_mechanism=fallback["economic_mechanism"],
            implementation_notes=fallback["implementation_notes"],
            parse_status=parse_status,
        )

    def _extract_pdf_text(self, pdf_local_path: Optional[str]) -> Optional[str]:
        if not pdf_local_path or not os.path.exists(pdf_local_path) or PdfReader is None:
            return None

        try:
            reader = PdfReader(pdf_local_path)
            chunks: List[str] = []
            page_count = min(len(reader.pages), 8)
            for page_index in range(page_count):
                text = reader.pages[page_index].extract_text() or ""
                text = text.strip()
                if text:
                    chunks.append(text)
                if sum(len(chunk) for chunk in chunks) >= 24000:
                    break
            if not chunks:
                return None
            return "\n\n".join(chunks)[:24000]
        except Exception as exc:
            logger.warning("Could not parse PDF %s: %s", pdf_local_path, exc)
            return None

    def _fallback_extract_from_text(
        self, *, summary: str, body_text: str, lane: str
    ) -> Dict[str, Any]:
        source_text = (body_text or summary or "").strip()
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", source_text)
            if sentence.strip()
        ]
        hypothesis = summary.strip()
        if len(hypothesis) < 40 and sentences:
            hypothesis = sentences[0]

        formula_candidates: List[str] = []
        for line in source_text.splitlines():
            candidate = line.strip()
            if not candidate:
                continue
            if "=" in candidate or re.search(r"\b(rank|zscore|regression|spread|ratio)\b", candidate, re.I):
                formula_candidates.append(candidate[:220])
            if len(formula_candidates) >= 5:
                break

        processing_steps: List[str] = []
        for sentence in sentences:
            if re.search(r"\b(normaliz|winsoriz|standardiz|rank|decay|regress|lag|difference|sort)\w*", sentence, re.I):
                processing_steps.append(sentence[:220])
            if len(processing_steps) >= 6:
                break

        datasets: List[str] = []
        for keyword in [
            "compustat",
            "crsp",
            "ibes",
            "optionmetrics",
            "analyst",
            "news",
            "fundamental",
            "balance sheet",
            "income statement",
            "cash flow",
            "price",
            "volume",
            "liquidity",
            "volatility",
        ]:
            if keyword.lower() in source_text.lower():
                datasets.append(keyword)

        economic_mechanism = ""
        for sentence in sentences:
            if re.search(r"\b(because|reflects|captures|driven by|due to|compensation)\b", sentence, re.I):
                economic_mechanism = sentence[:260]
                break
        if not economic_mechanism:
            economic_mechanism = hypothesis[:260]

        implementation_notes = (
            f"Fallback extraction for {lane}. Review PDF manually if score is high."
        )

        return {
            "hypothesis": hypothesis[:400],
            "formula_candidates": self._normalize_list(formula_candidates, limit=5),
            "data_processing_steps": self._normalize_list(processing_steps, limit=6),
            "dataset_mentions": self._normalize_list(datasets, limit=6),
            "economic_mechanism": economic_mechanism[:400],
            "implementation_notes": implementation_notes,
        }

    def _normalize_list(self, value: Any, limit: int = 6) -> List[str]:
        items: List[str] = []
        if isinstance(value, str):
            parts = re.split(r"[\n;,]+", value)
            items.extend(parts)
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                if isinstance(item, str):
                    items.append(item)
                elif item is not None:
                    items.append(str(item))
        elif value is not None:
            items.append(str(value))

        normalized: List[str] = []
        seen = set()
        for item in items:
            clean = " ".join(str(item).split()).strip()
            if not clean:
                continue
            key = clean.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(clean[:240])
            if len(normalized) >= limit:
                break
        return normalized
    def _request_data_fields(self, params: Dict[str, Any], retries: int = 4) -> Dict[str, Any]:
        generator = self._get_alpha_generator()
        last_error = ""
        for attempt in range(retries):
            try:
                response = generator.sess.get(
                    'https://api.worldquantbrain.com/data-fields',
                    params=params,
                    timeout=60,
                )
            except Exception as exc:
                last_error = str(exc)
                time.sleep(min(2 ** attempt, 8))
                continue

            if response.status_code == 200:
                return response.json()
            last_error = response.text[:300]
            if response.status_code == 429:
                wait_seconds = min(2 ** attempt, 10)
                logger.warning('Rate limited fetching data fields; sleeping %ss', wait_seconds)
                time.sleep(wait_seconds)
                continue
            logger.warning('Failed to fetch data fields: %s', last_error)
            break
        logger.warning('Giving up on data-fields request after retries: %s', last_error)
        return {}

    def get_available_fields(self) -> List[Dict[str, Any]]:
        if os.path.exists(self.field_cache_path):
            age_seconds = time.time() - os.path.getmtime(self.field_cache_path)
            if age_seconds < 24 * 3600:
                with open(self.field_cache_path, 'r', encoding='utf-8') as handle:
                    cached = json_loads(handle.read(), {})
                fields = cached.get('fields', [])
                if fields:
                    return fields

        base_params = {
            'delay': 1,
            'instrumentType': 'EQUITY',
            'region': 'USA',
            'universe': 'TOP3000',
        }
        fields_by_id: Dict[str, Dict[str, Any]] = {}

        for dataset_id in DEFAULT_FIELD_DATASETS:
            count_payload = self._request_data_fields(
                {**base_params, 'dataset.id': dataset_id, 'limit': 1, 'offset': 0}
            )
            total_count = int(count_payload.get('count', 0) or 0)
            fetch_target = min(total_count, FIELD_MAX_ROWS_PER_DATASET.get(dataset_id, 150))
            if fetch_target <= 0:
                continue

            for offset in range(0, fetch_target, FIELD_PAGE_SIZE):
                payload = self._request_data_fields(
                    {
                        **base_params,
                        'dataset.id': dataset_id,
                        'limit': min(FIELD_PAGE_SIZE, fetch_target - offset),
                        'offset': offset,
                    }
                )
                for row in payload.get('results', []) or []:
                    field_id = str(row.get('id', '')).strip()
                    if not field_id:
                        continue
                    fields_by_id[field_id] = {
                        'id': field_id,
                        'description': str(row.get('description', '') or ''),
                        'dataset_id': str((row.get('dataset') or {}).get('id', dataset_id) or dataset_id),
                        'dataset_name': str((row.get('dataset') or {}).get('name', '') or ''),
                        'category_name': str((row.get('category') or {}).get('name', '') or ''),
                        'subcategory_name': str((row.get('subcategory') or {}).get('name', '') or ''),
                        'type': str(row.get('type', '') or ''),
                    }
                time.sleep(FIELD_REQUEST_PAUSE_SECONDS)

        fields = sorted(fields_by_id.values(), key=lambda item: item['id'])
        if not fields:
            fallback_rows = self._get_alpha_generator().get_data_fields()
            fields = sorted(
                [
                    {
                        'id': str(row.get('id', '')).strip(),
                        'description': str(row.get('description', '') or ''),
                        'dataset_id': str((row.get('dataset') or {}).get('id', '') or ''),
                        'dataset_name': str((row.get('dataset') or {}).get('name', '') or ''),
                        'category_name': str((row.get('category') or {}).get('name', '') or ''),
                        'subcategory_name': str((row.get('subcategory') or {}).get('name', '') or ''),
                        'type': str(row.get('type', '') or ''),
                    }
                    for row in fallback_rows
                    if isinstance(row, dict) and row.get('id')
                ],
                key=lambda item: item['id'],
            )

        ensure_dir(os.path.dirname(self.field_cache_path) or '.')
        with open(self.field_cache_path, 'w', encoding='utf-8') as handle:
            handle.write(
                json.dumps(
                    {'generated_at': utc_now_iso(), 'fields': fields},
                    ensure_ascii=True,
                    indent=2,
                )
            )
        return fields

    def get_available_field_ids(self) -> List[str]:
        return [field['id'] for field in self.get_available_fields() if field.get('id')]

    def map_paper_to_fields(
        self, paper_id: int, paper_row: sqlite3.Row, card: PaperCard
    ) -> List[FieldMapping]:
        available_fields = self.get_available_fields()
        available_field_ids = {field['id'] for field in available_fields}
        if not available_field_ids:
            return []

        source_terms = self._extract_mapping_terms(paper_row, card)
        ranked = self._rank_candidate_fields(source_terms, available_fields, limit=5)
        mappings: List[FieldMapping] = []
        llm_assignments: Dict[Tuple[str, str], FieldMapping] = {}

        for term in source_terms:
            tokens = [token for token in tokenize_text(term) if token not in MAPPING_NOISE_TOKENS]
            for token in tokens:
                preferred_list = PREFERRED_FIELD_IDS_BY_TERM.get(token, [])
                for field_id in preferred_list:
                    if field_id in available_field_ids:
                        mappings.append(
                            FieldMapping(
                                paper_id=paper_id,
                                source_term=term,
                                mapped_field_id=field_id,
                                confidence=0.97,
                                rationale=f'preferred alias mapping for {token}',
                            )
                        )
                        break
                if any(mapping.source_term == term and mapping.rationale.startswith('preferred alias mapping') for mapping in mappings):
                    break

        if self.llm.available() and ranked:
            compact_candidates = {
                term: [
                    {
                        'field_id': candidate['field_id'],
                        'description': candidate['description'],
                        'dataset_id': candidate['dataset_id'],
                        'score': round(candidate['score'], 2),
                        'overlap_tokens': candidate['overlap_tokens'],
                    }
                    for candidate in candidates
                ]
                for term, candidates in ranked.items()
                if candidates
            }
            prompt = (
                "Map the finance-paper concepts to the most plausible WorldQuant field ids.\n"
                "Return a JSON array of objects with keys: source_term, mapped_field_id, confidence, rationale.\n"
                "Only include mappings with confidence >= 0.65.\n\n"
                f"Paper title: {paper_row['title']}\n"
                f"Hypothesis: {card.hypothesis}\n"
                f"Dataset mentions: {json_dumps(card.dataset_mentions)}\n"
                f"Candidate matches: {json_dumps(compact_candidates)}"
            )
            parsed = self.llm.complete_json(
                phase='field_mapping',
                system_prompt=FIELD_MAPPING_SYSTEM_PROMPT,
                user_prompt=prompt,
                paper_id=paper_id,
                max_tokens=900,
            )
            if isinstance(parsed, list):
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    source_term = str(item.get('source_term', '')).strip()
                    field_id = str(item.get('mapped_field_id', '')).strip()
                    confidence = safe_float(item.get('confidence'), 0.0)
                    if not source_term or not field_id or field_id not in available_field_ids:
                        continue
                    if confidence < 0.65:
                        continue
                    llm_assignments[(source_term.lower(), field_id)] = FieldMapping(
                        paper_id=paper_id,
                        source_term=source_term,
                        mapped_field_id=field_id,
                        confidence=confidence,
                        rationale=str(item.get('rationale', '')).strip()[:300],
                    )

        if llm_assignments:
            mappings.extend(llm_assignments.values())

        if not mappings:
            for term, candidates in ranked.items():
                if not candidates:
                    continue
                best = candidates[0]
                heuristic_confidence = clamp(0.32 + best['score'] * 0.08, 0.0, 0.92)
                if heuristic_confidence < 0.65:
                    continue
                mappings.append(
                    FieldMapping(
                        paper_id=paper_id,
                        source_term=term,
                        mapped_field_id=best['field_id'],
                        confidence=heuristic_confidence,
                        rationale=(
                            f"token overlap: {', '.join(best['overlap_tokens'])}; "
                            f"dataset={best['dataset_id']}; desc={best['description'][:120]}"
                        ),
                    )
                )

        unique: Dict[Tuple[str, str], FieldMapping] = {}
        for mapping in mappings:
            key = (mapping.source_term.lower(), mapping.mapped_field_id)
            if key not in unique or unique[key].confidence < mapping.confidence:
                unique[key] = mapping
        return sorted(unique.values(), key=lambda item: item.confidence, reverse=True)[:8]

    def _extract_mapping_terms(self, paper_row: sqlite3.Row, card: PaperCard) -> List[str]:
        terms: List[str] = []
        terms.extend(card.dataset_mentions)

        for item in card.formula_candidates[:4] + card.data_processing_steps[:4]:
            tokens = [token for token in tokenize_text(item) if token not in MAPPING_NOISE_TOKENS]
            if 1 <= len(tokens) <= 4 and set(tokens).intersection(DOMAIN_HINT_TOKENS):
                terms.append(' '.join(tokens))

        title_tokens = tokenize_text(paper_row['title'] or '')
        informative_title_tokens = [token for token in title_tokens if token in DOMAIN_HINT_TOKENS]
        if 1 <= len(informative_title_tokens) <= 4:
            terms.append(' '.join(informative_title_tokens))

        normalized = self._normalize_list(terms, limit=10)
        filtered_terms: List[str] = []
        for term in normalized:
            tokens = [token for token in tokenize_text(term) if token not in MAPPING_NOISE_TOKENS]
            if 1 <= len(tokens) <= 4:
                filtered_terms.append(' '.join(tokens))
        return self._normalize_list(filtered_terms, limit=8)

    def _rank_candidate_fields(
        self, source_terms: List[str], available_fields: List[Dict[str, Any]], limit: int = 5
    ) -> Dict[str, List[Dict[str, Any]]]:
        field_token_map: Dict[str, Dict[str, Any]] = {}
        for field in available_fields:
            field_id = field.get('id')
            if not field_id:
                continue
            id_tokens = {token for token in split_field_tokens(field_id) if token not in MAPPING_NOISE_TOKENS}
            meta_text = ' '.join(
                [
                    str(field.get('description', '') or ''),
                    str(field.get('dataset_name', '') or ''),
                    str(field.get('category_name', '') or ''),
                    str(field.get('subcategory_name', '') or ''),
                ]
            )
            meta_tokens = {token for token in tokenize_text(meta_text) if token not in MAPPING_NOISE_TOKENS}
            field_token_map[field_id] = {
                'field_id': field_id,
                'description': str(field.get('description', '') or ''),
                'dataset_id': str(field.get('dataset_id', '') or ''),
                'dataset_name': str(field.get('dataset_name', '') or ''),
                'id_tokens': id_tokens,
                'meta_tokens': meta_tokens,
            }

        ranked: Dict[str, List[Dict[str, Any]]] = {}
        for term in source_terms:
            term_tokens = {token for token in tokenize_text(term) if token not in MAPPING_NOISE_TOKENS}
            if not term_tokens:
                ranked[term] = []
                continue
            candidates: List[Dict[str, Any]] = []
            for field_id, field_info in field_token_map.items():
                id_overlap = sorted(term_tokens.intersection(field_info['id_tokens']))
                meta_overlap = sorted(term_tokens.intersection(field_info['meta_tokens']))
                overlap_tokens = sorted(set(id_overlap).union(meta_overlap))
                informative_overlap = [token for token in overlap_tokens if token in DOMAIN_HINT_TOKENS or len(token) >= 5]
                preferred_bonus = 0.0
                preferred_match_tokens = []
                for token in term_tokens:
                    preferred_list = PREFERRED_FIELD_IDS_BY_TERM.get(token, [])
                    if field_id in preferred_list:
                        preferred_bonus = max(preferred_bonus, 4.0 + max(0, len(preferred_list) - preferred_list.index(field_id)) * 0.35)
                        preferred_match_tokens.append(token)
                if not informative_overlap and preferred_bonus == 0.0:
                    continue
                score = len(id_overlap) * 3.0 + len(meta_overlap) * 1.5
                dataset_hints = DATASET_HINTS.get(field_info['dataset_id'], set())
                score += len(term_tokens.intersection(dataset_hints)) * 1.5
                if preferred_bonus > 0.0:
                    score += preferred_bonus
                    if not informative_overlap:
                        informative_overlap = preferred_match_tokens[:]
                if any(token in field_info['description'].lower() for token in informative_overlap):
                    score += 0.5
                if score < 2.5:
                    continue
                candidates.append(
                    {
                        'field_id': field_id,
                        'description': field_info['description'],
                        'dataset_id': field_info['dataset_id'],
                        'dataset_name': field_info['dataset_name'],
                        'score': float(score),
                        'overlap_tokens': informative_overlap,
                    }
                )
            candidates.sort(key=lambda item: (-item['score'], item['field_id']))
            ranked[term] = candidates[:limit]
        return ranked

    def score_paper(
        self,
        paper_row: sqlite3.Row,
        card: PaperCard,
        mappings: List[FieldMapping],
    ) -> Tuple[float, Dict[str, float]]:
        economic_clarity = 0.0
        if len(card.hypothesis) >= 60:
            economic_clarity += 16.0
        elif len(card.hypothesis) >= 25:
            economic_clarity += 10.0
        if len(card.economic_mechanism) >= 60:
            economic_clarity += 14.0
        elif len(card.economic_mechanism) >= 25:
            economic_clarity += 8.0
        economic_clarity = clamp(economic_clarity, 0.0, 30.0)

        formula_or_process_clarity = clamp(
            len(card.formula_candidates) * 6.0 + len(card.data_processing_steps) * 3.0,
            0.0,
            20.0,
        )

        unique_fields = {mapping.mapped_field_id for mapping in mappings}
        wq_data_overlap = clamp(len(unique_fields) * 6.5, 0.0, 25.0)

        templateability = 0.0
        if unique_fields:
            templateability += 6.0
        if card.formula_candidates:
            templateability += 4.0
        if card.data_processing_steps:
            templateability += 3.0
        if card.hypothesis:
            templateability += 2.0
        templateability = clamp(templateability, 0.0, 15.0)

        recency_decay = 0.0
        try:
            published_dt = datetime.fromisoformat(
                str(paper_row["published_at"]).replace("Z", "+00:00")
            )
            max_days = float(365 * self.lookback_years)
            age_days = max(0.0, (datetime.now(timezone.utc) - published_dt).days)
            recency_decay = clamp(10.0 * (1.0 - age_days / max_days), 0.0, 10.0)
        except Exception:
            recency_decay = 3.0

        metadata_empirical = self._metadata_empirical_score(paper_row)
        total_score = (
            economic_clarity
            + formula_or_process_clarity
            + wq_data_overlap
            + templateability
            + recency_decay
        )
        if metadata_empirical >= 6.0 and unique_fields:
            total_score = min(total_score + 5.0, 100.0)
        if not unique_fields:
            total_score = min(total_score, 35.0)
        if metadata_empirical <= 0 and not unique_fields:
            total_score = min(total_score, 25.0)
        if metadata_empirical < -4.0:
            total_score = min(total_score, 20.0 if not unique_fields else 45.0)
        if card.parse_status == "degraded":
            total_score = min(total_score, 40.0)

        breakdown = {
            "economic_clarity": round(economic_clarity, 2),
            "formula_or_process_clarity": round(formula_or_process_clarity, 2),
            "WQ_data_overlap": round(wq_data_overlap, 2),
            "templateability": round(templateability, 2),
            "recency_decay": round(recency_decay, 2),
            "metadata_empirical": round(metadata_empirical, 2),
            "total": round(total_score, 2),
        }
        return round(total_score, 2), breakdown

    def generate_templates_for_top_papers(self) -> int:
        paper_rows = self.db.get_untemplated_papers(
            limit=self.paper_budget,
            score_threshold=self.score_threshold,
        )
        created = 0
        for row in paper_rows:
            paper_id = int(row["id"])
            card_row = self.db.get_paper_card(paper_id)
            if card_row is None:
                continue
            card = PaperCard(
                paper_id=paper_id,
                lane=card_row["lane"] or "OTHER",
                hypothesis=card_row["hypothesis"] or "",
                formula_candidates=json_loads(card_row["formula_candidates_json"], []),
                data_processing_steps=json_loads(card_row["data_processing_steps_json"], []),
                dataset_mentions=json_loads(card_row["dataset_mentions_json"], []),
                economic_mechanism=card_row["economic_mechanism"] or "",
                implementation_notes=card_row["implementation_notes"] or "",
                parse_status=card_row["parse_status"] or "parsed",
                implementability_score=safe_float(card_row["implementability_score"]),
            )
            mappings = [
                FieldMapping(
                    paper_id=paper_id,
                    source_term=mapping_row["source_term"],
                    mapped_field_id=mapping_row["mapped_field_id"],
                    confidence=safe_float(mapping_row["confidence"]),
                    rationale=mapping_row["rationale"] or "",
                )
                for mapping_row in self.db.get_field_mappings(paper_id)
            ]
            templates = self.generate_templates(row, card, mappings)
            if not templates:
                continue
            created += len(self.db.upsert_template_cards(paper_id, templates))
            self.db.update_paper_state(paper_id, "templated")

        logger.info("Generated %s template cards", created)
        return created

    def generate_templates(
        self,
        paper_row: sqlite3.Row,
        card: PaperCard,
        mappings: List[FieldMapping],
    ) -> List[TemplateCard]:
        mapped_fields = []
        seen_fields = set()
        for mapping in sorted(mappings, key=lambda item: item.confidence, reverse=True):
            if mapping.mapped_field_id in seen_fields:
                continue
            seen_fields.add(mapping.mapped_field_id)
            mapped_fields.append(mapping.mapped_field_id)

        templates: List[TemplateCard] = []
        paper_id = int(paper_row["id"])
        if self.llm.available() and mapped_fields:
            prompt = (
                "Create up to 3 WorldQuant-style alpha template cards from this paper.\n"
                "Return a JSON array. Each object must contain: arity, preprocess_ops, "
                "comparison_pattern, logic_ops, risk_control_ops, econ_thesis, "
                "instantiation_rules, expected_turnover_band, expression_blueprint.\n"
                "Use placeholders {{FIELD_1}}, {{FIELD_2}}, {{FIELD_3}}.\n"
                "The template must follow: preprocessing -> comparison relationship -> detail adjustment.\n\n"
                f"Paper title: {paper_row['title']}\n"
                f"Lane: {card.lane}\n"
                f"Hypothesis: {card.hypothesis}\n"
                f"Economic mechanism: {card.economic_mechanism}\n"
                f"Formula candidates: {json_dumps(card.formula_candidates)}\n"
                f"Processing steps: {json_dumps(card.data_processing_steps)}\n"
                f"Mapped field ids: {json_dumps(mapped_fields[:6])}"
            )
            parsed = self.llm.complete_json(
                phase="paper_template",
                system_prompt=PAPER_TEMPLATE_SYSTEM_PROMPT,
                user_prompt=prompt,
                paper_id=paper_id,
                max_tokens=1200,
            )
            if isinstance(parsed, list):
                for item in parsed[:3]:
                    if not isinstance(item, dict):
                        continue
                    arity = str(item.get("arity", "unary")).strip().lower()
                    if arity not in {"unary", "binary", "ternary"}:
                        arity = "unary"
                    blueprint = str(item.get("expression_blueprint", "")).strip()
                    if not blueprint:
                        continue
                    required = 1 if arity == "unary" else 2 if arity == "binary" else 3
                    if any(f"{{{{FIELD_{index}}}}}" not in blueprint for index in range(1, required + 1)):
                        continue
                    templates.append(
                        TemplateCard(
                            paper_id=paper_id,
                            arity=arity,
                            preprocess_ops=self._normalize_list(item.get("preprocess_ops"), limit=6),
                            comparison_pattern=str(item.get("comparison_pattern", "")).strip()[:240],
                            logic_ops=self._normalize_list(item.get("logic_ops"), limit=6),
                            risk_control_ops=self._normalize_list(item.get("risk_control_ops"), limit=6),
                            econ_thesis=str(item.get("econ_thesis", "")).strip()[:400],
                            instantiation_rules=item.get("instantiation_rules", {})
                            if isinstance(item.get("instantiation_rules"), dict)
                            else {},
                            expected_turnover_band=str(
                                item.get("expected_turnover_band", "medium")
                            ).strip()[:80],
                            expression_blueprint=blueprint[:320],
                        )
                    )

        if templates:
            return templates[:3]

        if len(mapped_fields) >= 2:
            return [
                TemplateCard(
                    paper_id=paper_id,
                    arity="binary",
                    preprocess_ops=["ts_zscore", "rank"],
                    comparison_pattern="relative ratio",
                    logic_ops=["divide"],
                    risk_control_ops=["rank"],
                    econ_thesis=card.hypothesis[:300] or card.economic_mechanism[:300],
                    instantiation_rules={"max_variants": 3},
                    expected_turnover_band="medium",
                    expression_blueprint="rank(ts_zscore(divide({{FIELD_1}}, add(abs({{FIELD_2}}), 0.001)), 120))",
                ),
                TemplateCard(
                    paper_id=paper_id,
                    arity="binary",
                    preprocess_ops=["ts_zscore"],
                    comparison_pattern="cross-field spread",
                    logic_ops=["subtract"],
                    risk_control_ops=["rank"],
                    econ_thesis=card.economic_mechanism[:300] or card.hypothesis[:300],
                    instantiation_rules={"max_variants": 3},
                    expected_turnover_band="medium",
                    expression_blueprint="rank(subtract(ts_zscore({{FIELD_1}}, 60), ts_zscore({{FIELD_2}}, 60)))",
                ),
            ][:3]

        if mapped_fields:
            return [
                TemplateCard(
                    paper_id=paper_id,
                    arity="unary",
                    preprocess_ops=["ts_zscore", "rank"],
                    comparison_pattern="single-field deviation",
                    logic_ops=[],
                    risk_control_ops=["rank"],
                    econ_thesis=card.hypothesis[:300] or card.economic_mechanism[:300],
                    instantiation_rules={"max_variants": 3},
                    expected_turnover_band="low-medium",
                    expression_blueprint="rank(ts_zscore({{FIELD_1}}, 120))",
                )
            ]

        return []
    def instantiate_templates(self) -> int:
        created = 0
        paper_rows = self.db.get_top_scored_papers(
            limit=self.paper_budget,
            score_threshold=self.score_threshold,
        )
        for paper_row in paper_rows:
            paper_id = int(paper_row["id"])
            mapping_rows = self.db.get_field_mappings(paper_id)
            if not mapping_rows:
                continue
            template_rows = self.db.get_template_rows(paper_id=paper_id)
            for template_row in template_rows:
                expressions = self.instantiate_template(template_row, mapping_rows)
                for expression, field_bindings in expressions:
                    self.db.insert_candidate(int(template_row["id"]), expression, field_bindings)
                    created += 1
                if expressions:
                    self.db.update_paper_state(paper_id, "instantiated")

        logger.info("Instantiated %s expressions from template cards", created)
        return created

    def instantiate_template(
        self, template_row: sqlite3.Row, mapping_rows: List[sqlite3.Row]
    ) -> List[Tuple[str, Dict[str, str]]]:
        blueprint = (template_row["expression_blueprint"] or "").strip()
        if not blueprint:
            return []

        arity = (template_row["arity"] or "unary").strip().lower()
        required = 1 if arity == "unary" else 2 if arity == "binary" else 3
        field_ids: List[str] = []
        seen = set()
        for mapping_row in sorted(mapping_rows, key=lambda row: safe_float(row["confidence"]), reverse=True):
            field_id = mapping_row["mapped_field_id"]
            if field_id in seen:
                continue
            seen.add(field_id)
            field_ids.append(field_id)

        if len(field_ids) < required:
            return []

        combinations: List[Tuple[str, ...]] = []
        if required == 1:
            combinations = [(field_id,) for field_id in field_ids[:3]]
        elif required == 2:
            for left_index in range(len(field_ids)):
                for right_index in range(left_index + 1, len(field_ids)):
                    combinations.append((field_ids[left_index], field_ids[right_index]))
                    if len(combinations) >= 3:
                        break
                if len(combinations) >= 3:
                    break
        else:
            for first_index in range(len(field_ids)):
                for second_index in range(first_index + 1, len(field_ids)):
                    for third_index in range(second_index + 1, len(field_ids)):
                        combinations.append(
                            (
                                field_ids[first_index],
                                field_ids[second_index],
                                field_ids[third_index],
                            )
                        )
                        if len(combinations) >= 3:
                            break
                    if len(combinations) >= 3:
                        break
                if len(combinations) >= 3:
                    break

        expressions: List[Tuple[str, Dict[str, str]]] = []
        seen_expressions = set()
        for combo in combinations:
            field_bindings = {
                f"FIELD_{index + 1}": field_id for index, field_id in enumerate(combo)
            }
            base_expression = blueprint
            for placeholder, field_id in field_bindings.items():
                base_expression = base_expression.replace(f"{{{{{placeholder}}}}}", field_id)

            variants = [base_expression]
            if not base_expression.startswith("rank("):
                variants.append(f"rank({base_expression})")
            if "ts_zscore(" not in base_expression:
                variants.append(f"ts_zscore({base_expression}, 60)")

            for candidate in variants:
                expression = candidate.strip()
                if expression in seen_expressions:
                    continue
                if not self._validate_expression(expression, arity, list(field_bindings.values())):
                    continue
                seen_expressions.add(expression)
                expressions.append((expression, field_bindings))
                if len(expressions) >= 3:
                    return expressions

        return expressions

    def _validate_expression(
        self, expression: str, arity: str, required_fields: List[str]
    ) -> bool:
        if not expression:
            return False
        if "{{FIELD_" in expression or ";" in expression:
            return False
        if len(expression) > 320:
            return False
        if not re.fullmatch(r"[A-Za-z0-9_.,()\-+/*<>=! ]+", expression):
            return False

        balance = 0
        for char in expression:
            if char == "(":
                balance += 1
            elif char == ")":
                balance -= 1
                if balance < 0:
                    return False
        if balance != 0:
            return False

        present_fields = [field_id for field_id in required_fields if field_id in expression]
        required = 1 if arity == "unary" else 2 if arity == "binary" else 3
        if len(set(present_fields)) < required:
            return False

        if arity in {"binary", "ternary"} and not any(
            operator in expression
            for operator in [
                "add(",
                "subtract(",
                "divide(",
                "multiply(",
                "ts_corr(",
                "ts_covariance(",
                "if_else(",
                "group_neutralize(",
                "rank(",
            ]
        ):
            return False

        return True

    def backtest_pending_candidates(self, limit: int = 30) -> int:
        candidate_rows = self.db.get_pending_candidates(limit=max(1, limit))
        if not candidate_rows:
            logger.info("No pending instantiation candidates to backtest")
            return 0

        expressions = [row["expression"] for row in candidate_rows]
        generator = self._get_alpha_generator()
        generator.results = []
        generator.pending_results = {}
        generator.test_alpha_batch(expressions)
        results = generator.get_results()
        result_map = {row["alpha"]: row for row in results}

        simulated = 0
        for candidate_row in candidate_rows:
            candidate_id = int(candidate_row["id"])
            expression = candidate_row["expression"]
            payload = result_map.get(expression)
            if not payload:
                self.db.mark_candidate_status(candidate_id, "error")
                continue

            raw_result = payload.get("result", {}) or {}
            alpha_data = payload.get("alpha_data", {}) or {}
            is_data = alpha_data.get("is", {}) or {}
            checks = is_data.get("checks", []) or alpha_data.get("checks", []) or []
            sharpe = safe_float(is_data.get("sharpe"), 0.0)
            fitness = safe_float(is_data.get("fitness"), 0.0)
            turnover = safe_float(is_data.get("turnover"), 0.0)
            returns_value = safe_float(is_data.get("returns"), 0.0)
            grade = alpha_data.get("grade")
            status = str(raw_result.get("status", "simulated")).lower()

            simulation_run_id = self.db.insert_simulation_run(
                candidate_id=candidate_id,
                expression=expression,
                sharpe=sharpe,
                fitness=fitness,
                turnover=turnover,
                returns_value=returns_value,
                grade=grade,
                checks=checks if isinstance(checks, list) else [],
                raw_result={"result": raw_result, "alpha_data": alpha_data},
                status=status,
            )
            self.db.mark_candidate_status(candidate_id, "simulated")
            if self._is_mutation_eligible(sharpe, fitness, checks):
                self.db.enqueue_mutation(
                    simulation_run_id=simulation_run_id,
                    reason=self._build_mutation_reason(sharpe, fitness, checks),
                    priority=max(sharpe, fitness),
                )
            simulated += 1

        logger.info("Backtested %s paper-instantiated candidates", simulated)
        return simulated

    def _is_mutation_eligible(
        self, sharpe: float, fitness: float, checks: List[Dict[str, Any]]
    ) -> bool:
        if sharpe < 0.5 and fitness < 0.5:
            return False
        for check in checks:
            if not isinstance(check, dict):
                continue
            name = str(check.get("name") or check.get("label") or "").upper()
            result = str(check.get("result") or check.get("status") or "").upper()
            if name == "CONCENTRATED_WEIGHT" and result == "FAIL":
                return False
        return True

    def _build_mutation_reason(
        self, sharpe: float, fitness: float, checks: List[Dict[str, Any]]
    ) -> str:
        failed_checks: List[str] = []
        for check in checks:
            if not isinstance(check, dict):
                continue
            result = str(check.get("result") or check.get("status") or "").upper()
            if result != "FAIL":
                continue
            name = str(check.get("name") or check.get("label") or "UNKNOWN").upper()
            failed_checks.append(name)
        if failed_checks:
            return f"mutate_after_checks:{','.join(sorted(set(failed_checks)))}"
        return f"mutate_after_metrics:sharpe={round(sharpe, 3)},fitness={round(fitness, 3)}"

    def run_research_round(self, backtest_budget: int = 30) -> Dict[str, Any]:
        synced = self.sync_papers()
        prepared = self.prepare_recent_papers()
        templated = self.generate_templates_for_top_papers()
        instantiated = self.instantiate_templates()
        simulated = self.backtest_pending_candidates(limit=backtest_budget)
        summary = self.db.get_summary_counts()
        summary.update(
            {
                "synced": synced,
                "prepared": prepared,
                "templated_now": templated,
                "instantiated_now": instantiated,
                "simulated_now": simulated,
            }
        )
        return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Paper-driven alpha research pipeline")
    parser.add_argument(
        "--mode",
        choices=["sync", "extract", "research", "backtest"],
        default="research",
    )
    parser.add_argument("--credentials", default="./credential.txt")
    parser.add_argument("--ollama-url", default="http://localhost:11434")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--pdf-dir", default=DEFAULT_PDF_DIR)
    parser.add_argument(
        "--arxiv-categories",
        default=",".join(DEFAULT_ARXIV_CATEGORIES),
    )
    parser.add_argument(
        "--lookback-years",
        type=int,
        default=int(os.getenv("ARXIV_LOOKBACK_YEARS", DEFAULT_LOOKBACK_YEARS)),
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=int(os.getenv("ARXIV_MAX_RESULTS", DEFAULT_MAX_RESULTS)),
    )
    parser.add_argument(
        "--score-threshold",
        type=float,
        default=float(os.getenv("PAPER_SCORE_THRESHOLD", DEFAULT_SCORE_THRESHOLD)),
    )
    parser.add_argument(
        "--paper-budget",
        type=int,
        default=int(os.getenv("PAPER_RESEARCH_BUDGET", DEFAULT_PAPER_BUDGET)),
    )
    parser.add_argument("--backtest-budget", type=int, default=30)
    parser.add_argument("--field-cache-path", default=DEFAULT_FIELD_CACHE)
    parser.add_argument("--max-concurrent", type=int, default=2)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    categories = [item.strip() for item in args.arxiv_categories.split(",") if item.strip()]
    pipeline = PaperResearchPipeline(
        credentials_path=args.credentials,
        ollama_url=args.ollama_url,
        db_path=args.db_path,
        pdf_dir=args.pdf_dir,
        categories=categories,
        lookback_years=args.lookback_years,
        max_results=args.max_results,
        score_threshold=args.score_threshold,
        paper_budget=args.paper_budget,
        field_cache_path=args.field_cache_path,
        max_concurrent=args.max_concurrent,
    )

    if args.mode == "sync":
        result: Dict[str, Any] = {"synced": pipeline.sync_papers()}
    elif args.mode == "extract":
        result = {"prepared": pipeline.prepare_recent_papers()}
    elif args.mode == "backtest":
        result = {"simulated_now": pipeline.backtest_pending_candidates(args.backtest_budget)}
    else:
        result = pipeline.run_research_round(backtest_budget=args.backtest_budget)

    result["summary"] = pipeline.db.get_summary_counts()
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()

