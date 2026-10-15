import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, confusion_matrix, fbeta_score, precision_score, recall_score
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "ml" / "training-data.csv"
FAMILIES_PATH = ROOT / "ml" / "scenario-families.json"
OUTPUT_PATH = ROOT / "lib" / "ml" / "model.json"

CONTINUOUS_FEATURES = [
    "recipient_tx_count_log1p",
    "amount_to_recent_median_ratio",
]
SEMANTIC_SIGNALS = [
    "urgency",
    "secrecy_request",
    "guaranteed_or_high_return",
    "impersonation",
    "unexpected_contact",
    "move_money_to_protect",
    "advance_fee_or_prize",
    "romance_or_online_only_relationship",
    "payment_method_demand",
]
FEATURE_ORDER = [
    "is_new_recipient",
    *CONTINUOUS_FEATURES,
    "context_present",
    *[feature for signal in SEMANTIC_SIGNALS for feature in (signal, f"{signal}_known")],
]


def metrics_at(labels: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    predictions = (scores >= threshold).astype(int)
    matrix = confusion_matrix(labels, predictions, labels=[0, 1]).tolist()
    return {
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f2": float(fbeta_score(labels, predictions, beta=2, zero_division=0)),
        "confusionMatrix": matrix,
    }


def choose_thresholds(labels: list[int], scores: list[float]) -> tuple[float, float]:
    label_array = np.asarray(labels, dtype=int)
    score_array = np.asarray(scores, dtype=float)
    candidates = sorted(set(float(score) for score in scores))

    review_candidates = [
        (threshold, metrics_at(label_array, score_array, threshold))
        for threshold in candidates
        if metrics_at(label_array, score_array, threshold)["recall"] >= 0.95
    ]
    if not review_candidates:
        review = min(candidates)
    else:
        review = max(
            review_candidates,
            key=lambda item: (item[1]["precision"], item[0]),
        )[0]

    high_candidates = [
        (threshold, metrics_at(label_array, score_array, threshold))
        for threshold in candidates
        if threshold > review
        and metrics_at(label_array, score_array, threshold)["precision"] >= 0.80
    ]
    if not high_candidates:
        high = 1.0
    else:
        high = max(
            high_candidates,
            key=lambda item: (item[1]["recall"], item[0]),
        )[0]

    return float(review), float(high)


def fixed_rule_scores(frame: pd.DataFrame) -> np.ndarray:
    critical = (
        (frame["guaranteed_or_high_return"] == 1)
        | (frame["move_money_to_protect"] == 1)
        | (frame["advance_fee_or_prize"] == 1)
        | (frame["romance_or_online_only_relationship"] == 1)
        | ((frame["impersonation"] == 1) & (frame["urgency"] == 1))
        | ((frame["unexpected_contact"] == 1) & (frame["payment_method_demand"] == 1))
        | ((frame["secrecy_request"] == 1) & (frame["is_new_recipient"] == 1))
    )
    return critical.astype(int).to_numpy()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def train() -> dict:
    frame = pd.read_csv(DATA_PATH)
    labeled = frame[frame["split"] != "challenge"].copy()
    split_frames = {
        split: labeled[labeled["split"] == split].copy()
        for split in ("train", "validation", "test")
    }

    scaler = StandardScaler()
    scaler.fit(split_frames["train"][CONTINUOUS_FEATURES])

    def matrix(part: pd.DataFrame) -> np.ndarray:
        values = part[FEATURE_ORDER].astype(float).copy()
        values[CONTINUOUS_FEATURES] = scaler.transform(values[CONTINUOUS_FEATURES])
        return values.to_numpy()

    model = LogisticRegression(
        solver="liblinear",
        penalty="l2",
        C=1.0,
        random_state=42,
        max_iter=1000,
    )
    train_frame = split_frames["train"]
    model.fit(matrix(train_frame), train_frame["label"].astype(int).to_numpy())

    validation_frame = split_frames["validation"]
    validation_labels = validation_frame["label"].astype(int).to_numpy()
    validation_scores = model.predict_proba(matrix(validation_frame))[:, 1]
    review_threshold, high_threshold = choose_thresholds(
        validation_labels.tolist(), validation_scores.tolist()
    )

    test_frame = split_frames["test"]
    test_labels = test_frame["label"].astype(int).to_numpy()
    test_scores = model.predict_proba(matrix(test_frame))[:, 1]
    test_metrics = metrics_at(test_labels, test_scores, review_threshold)
    test_metrics["averagePrecision"] = float(average_precision_score(test_labels, test_scores))
    test_metrics["support"] = int(len(test_labels))
    false_negative_rows = test_frame[
        (test_labels == 1) & (test_scores < review_threshold)
    ]
    test_metrics["falseNegativeFamilies"] = sorted(
        false_negative_rows["scenario_family_id"].unique().tolist()
    )

    baseline_predictions = fixed_rule_scores(test_frame)
    baseline_f2 = float(fbeta_score(test_labels, baseline_predictions, beta=2, zero_division=0))
    test_metrics["ruleBaselineF2"] = baseline_f2
    if test_metrics["f2"] < baseline_f2:
        raise RuntimeError("model does not match the fixed-rule baseline on held-out families")

    coefficients = model.coef_[0]
    coefficient_map = dict(zip(FEATURE_ORDER, coefficients, strict=True))
    critical_features = [
        "guaranteed_or_high_return",
        "move_money_to_protect",
        "advance_fee_or_prize",
        "romance_or_online_only_relationship",
    ]
    if any(coefficient_map[feature] <= 0 for feature in critical_features):
        raise RuntimeError("a critical scam indicator received a non-positive coefficient")

    golden_rows = pd.concat(
        [test_frame[test_frame["label"] == 0].head(3), test_frame[test_frame["label"] == 1].head(3)]
    )
    golden_matrix = matrix(golden_rows)
    golden_scores = model.predict_proba(golden_matrix)[:, 1]
    golden_vectors = [
        {
            "caseId": row["case_id"],
            "features": {
                feature: float(value)
                for feature, value in zip(FEATURE_ORDER, feature_values, strict=True)
            },
            "score": float(score),
        }
        for (_, row), feature_values, score in zip(
            golden_rows.iterrows(), golden_matrix, golden_scores, strict=True
        )
    ]

    artifact = {
        "schemaVersion": 1,
        "modelType": "logistic_regression",
        "modelVersion": "scam-context-v1",
        "positiveLabel": "suspicious_context",
        "featureOrder": FEATURE_ORDER,
        "transforms": {
            feature: {
                "type": "standardize",
                "mean": float(mean),
                "scale": float(scale),
            }
            for feature, mean, scale in zip(
                CONTINUOUS_FEATURES, scaler.mean_, scaler.scale_, strict=True
            )
        },
        "coefficients": [float(value) for value in coefficients],
        "intercept": float(model.intercept_[0]),
        "link": "sigmoid",
        "thresholds": {
            "review": review_threshold,
            "highRisk": high_threshold,
        },
        "training": {
            "seed": 42,
            "datasetSha256": file_sha256(DATA_PATH),
            "scenarioFamiliesSha256": file_sha256(FAMILIES_PATH),
            "scikitLearnVersion": sklearn.__version__,
            "splitUnit": "scenario_family_id",
        },
        "testMetrics": test_metrics,
        "coefficientAudit": {
            feature: float(coefficient_map[feature]) for feature in critical_features
        },
        "goldenVectors": golden_vectors,
        "limitations": [
            "Curated simulated scenarios are not representative of real-world fraud prevalence.",
            "The score ranks suspicious context and is not a calibrated fraud probability.",
            "The model must fall back to deterministic rules when required structured inputs are missing.",
        ],
    }
    return artifact


def main() -> None:
    artifact = train()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(artifact, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "modelVersion": artifact["modelVersion"],
                "thresholds": artifact["thresholds"],
                "testMetrics": artifact["testMetrics"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
