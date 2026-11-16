"""Learning model: gradient-boosted classifier per bucket (D0 / D1), walk-forward validated, retrained as data grows."""
from __future__ import annotations

import json
import logging
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from pydantic import BaseModel
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, classification_report

from .config import Settings
from .schemas import Bucket, FeatureRow, MLPrediction, Signal

log = logging.getLogger(__name__)
CLASSES = [Signal.BUY_CE.value, Signal.BUY_PE.value, Signal.SKIP.value]


class ModelMeta(BaseModel):
    bucket: Bucket
    trained_at: datetime
    n_rows: int
    n_bucket_rows: int
    class_counts: dict[str, int]
    walk_forward: dict[str, float]


def _make_clf() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=250, learning_rate=0.05, max_depth=4, min_samples_leaf=20,
        l2_regularization=1.0, class_weight="balanced", random_state=42,
    )


def _weights(df: pd.DataFrame, bucket: Bucket, w: float) -> np.ndarray:
    target_dte = 0 if bucket == "D0" else 1
    return np.where(df.dte == target_dte, w, 1.0)


def _decide(proba: np.ndarray, min_conf: float) -> list[str]:
    """CE/PE only when its probability ≥ min_conf AND beats the other side; otherwise SKIP."""
    out = []
    for p_ce, p_pe, _ in proba:
        if p_ce >= min_conf and p_ce > p_pe:
            out.append(Signal.BUY_CE.value)
        elif p_pe >= min_conf and p_pe > p_ce:
            out.append(Signal.BUY_PE.value)
        else:
            out.append(Signal.SKIP.value)
    return out


def walk_forward(df: pd.DataFrame, bucket: Bucket, s: Settings, n_folds: int = 5) -> dict[str, float]:
    """Expanding-window, split by date. Scored only on rows of the bucket being modelled."""
    X_cols = FeatureRow.columns()
    dates = np.array(sorted(df.date.unique()))
    folds = np.array_split(dates[len(dates) // 3:], n_folds)   # first third = minimum training set
    target_dte = 0 if bucket == "D0" else 1
    y_true, y_pred = [], []
    for fold in folds:
        if len(fold) == 0:
            continue
        tr = df[df.date < fold[0]]
        te = df[df.date.isin(fold) & (df.dte == target_dte)]
        if te.empty or tr.y.nunique() < 3:
            continue
        clf = _make_clf().fit(tr[X_cols], tr.y, sample_weight=_weights(tr, bucket, s.bucket_weight))
        proba = _ordered_proba(clf, te[X_cols])
        y_true += list(te.y)
        y_pred += _decide(proba, s.min_confidence)
    if not y_true:
        return {}
    yt, yp = np.array(y_true), np.array(y_pred)
    traded = yp != Signal.SKIP.value
    hit = float((yt[traded] == yp[traded]).mean()) if traded.any() else 0.0
    log.info("\n%s", classification_report(yt, yp, zero_division=0))
    return {
        "accuracy": float(accuracy_score(yt, yp)),
        "trades": float(traded.sum()),
        "trade_rate": float(traded.mean()),
        "trade_hit_rate": hit,          # of the CE/PE calls, how often target came before stop
        "base_rate_ce": float((yt == "BUY_CE").mean()),
        "base_rate_pe": float((yt == "BUY_PE").mean()),
    }


def _ordered_proba(clf, X) -> np.ndarray:
    p = clf.predict_proba(X)
    idx = [list(clf.classes_).index(c) if c in clf.classes_ else None for c in CLASSES]
    return np.column_stack([p[:, i] if i is not None else np.zeros(len(X)) for i in idx])


def train(df: pd.DataFrame, bucket: Bucket, s: Settings) -> ModelMeta:
    X_cols = FeatureRow.columns()
    wf = walk_forward(df, bucket, s)
    clf = _make_clf().fit(df[X_cols], df.y, sample_weight=_weights(df, bucket, s.bucket_weight))
    target_dte = 0 if bucket == "D0" else 1
    meta = ModelMeta(
        bucket=bucket, trained_at=datetime.now(), n_rows=len(df),
        n_bucket_rows=int((df.dte == target_dte).sum()),
        class_counts={k: int(v) for k, v in df[df.dte == target_dte].y.value_counts().items()},
        walk_forward=wf,
    )
    joblib.dump(clf, s.model_dir / f"sensex_{bucket}.joblib")
    (s.model_dir / f"sensex_{bucket}.json").write_text(meta.model_dump_json(indent=2))
    return meta


class Predictor:
    def __init__(self, s: Settings):
        self.s = s
        self.models = {}
        for b in ("D0", "D1"):
            p = s.model_dir / f"sensex_{b}.joblib"
            if p.exists():
                self.models[b] = joblib.load(p)

    def meta(self, bucket: Bucket) -> dict:
        p = self.s.model_dir / f"sensex_{bucket}.json"
        return json.loads(p.read_text()) if p.exists() else {}

    def predict(self, bucket: Bucket, f: FeatureRow) -> MLPrediction:
        if bucket not in self.models:
            raise RuntimeError(f"No model for {bucket}. Run: python -m sensex_ai.cli train")
        X = pd.DataFrame([f.model_dump()])[FeatureRow.columns()]
        p_ce, p_pe, p_skip = _ordered_proba(self.models[bucket], X)[0]
        sig = _decide(np.array([[p_ce, p_pe, p_skip]]), self.s.min_confidence)[0]
        return MLPrediction(bucket=bucket, signal=Signal(sig), p_ce=p_ce, p_pe=p_pe, p_skip=p_skip)
