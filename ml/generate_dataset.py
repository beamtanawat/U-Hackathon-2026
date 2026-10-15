import argparse
import csv
import json
import math
import random
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FAMILIES_PATH = ROOT / "scenario-families.json"
OUTPUT_PATH = ROOT / "training-data.csv"
SEED = 42
SPLITS = {"train", "validation", "test", "challenge"}
SIGNALS = [
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


def known_signals(family: dict) -> set[str]:
    value = family["known_signals"]
    return set(SIGNALS) if value == "all" else set(value)


def load_families() -> list[dict]:
    return json.loads(FAMILIES_PATH.read_text(encoding="utf-8"))


def validate_families(families: list[dict]) -> None:
    assert len(families) >= 36, "at least 36 scenario families are required"
    ids = [family["id"] for family in families]
    assert len(ids) == len(set(ids)), "scenario family IDs must be unique"

    for family in families:
        assert family["split"] in SPLITS, f"invalid split for {family['id']}"
        expected_labels = {None} if family["split"] == "challenge" else {0, 1}
        assert family["label"] in expected_labels, f"invalid label for {family['id']}"
        assert family["variations"] >= 8, f"too few variations for {family['id']}"
        assert family["recipient_tx_count"] >= 0
        assert family["amount_ratio"] >= 0
        known = known_signals(family)
        assert set(family["signals"]) <= known
        assert known <= set(SIGNALS)

    for split in ("train", "validation", "test"):
        labels = {family["label"] for family in families if family["split"] == split}
        assert labels == {0, 1}, f"{split} must contain both labels"


def generate_rows(families: list[dict]) -> list[dict]:
    rng = random.Random(SEED)
    rows = []
    case_ids = set()

    for family in families:
        for index in range(family["variations"]):
            case_id = f"{family['id']}-{index + 1:02d}"
            assert case_id not in case_ids, f"duplicate case ID: {case_id}"
            case_ids.add(case_id)
            count = max(0, family["recipient_tx_count"] + rng.choice([-1, 0, 1]))
            ratio = min(10.0, family["amount_ratio"] * rng.uniform(0.9, 1.1))
            known = known_signals(family)
            active = set(family["signals"])
            row = {
                "scenario_family_id": family["id"],
                "case_id": case_id,
                "split": family["split"],
                "label": "" if family["label"] is None else family["label"],
                "is_new_recipient": int(family["is_new_recipient"]),
                "recipient_tx_count_log1p": math.log1p(count),
                "amount_to_recent_median_ratio": ratio,
                "context_present": int(bool(known)),
                "structured_provenance": "simulated",
                "context_provenance": "unavailable" if not known else "simulated",
            }
            for signal in SIGNALS:
                row[signal] = int(signal in active)
                row[f"{signal}_known"] = int(signal in known)
            rows.append(row)

    assert len(rows) == len(case_ids), "case IDs must be unique"
    return rows


def write_rows(rows: list[dict]) -> None:
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    families = load_families()
    validate_families(families)
    rows = generate_rows(families)
    if not args.check_only:
        write_rows(rows)
    print(f"validated {len(families)} families and {len(rows)} cases")


if __name__ == "__main__":
    main()
