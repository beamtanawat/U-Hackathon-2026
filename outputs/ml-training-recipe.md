# U-HANDSHAKE Scam-Context ML Training Recipe

## Recommendation

Use an L2-regularized logistic-regression classifier trained offline on curated synthetic scenario families. Export coefficients, transforms, thresholds, metrics, and provenance as plain JSON for deterministic TypeScript inference on Vercel.

The classifier estimates only contextual scam risk. Safe-to-Pay arithmetic remains deterministic code.

## Ranked Options

1. **L2 Logistic Regression — selected.** Small, inspectable, reproducible, and easy to match between Python and TypeScript.
2. **Fixed weighted rules — required baseline and fallback.** Ship the rule score instead if the trained model cannot match it on held-out scenario families.
3. **Tree or boosting model — rejected for this MVP.** Adds export and explanation work and is likely to overfit a small synthetic dataset.

Do not add Random Forest, XGBoost, ONNX, SHAP, model-serving infrastructure, or probability calibration for the hackathon MVP.

## Model Configuration

```python
LogisticRegression(
    solver="liblinear",
    penalty="l2",
    C=1.0,
    random_state=42,
    max_iter=1000,
)
```

Compare `C` values of `0.1`, `1.0`, and `10.0` on validation only if the default fails the acceptance checks. Do not run a broad search.

## Dataset Design

- Create 36–48 curated scenario families with approximately equal benign and suspicious-context labels.
- Generate 8–15 controlled variations per family, targeting 300–700 rows.
- Keep all variations from one family in one split to prevent template leakage.
- Pre-assign approximately 70% train, 15% validation, and 15% test families with both labels in each split.
- Keep ambiguous cases in a separate qualitative challenge set rather than forcing binary labels.
- Label the positive class `suspicious_context`, never `fraud_confirmed`.
- Store `scenario_family_id`, `case_id`, `split`, `label`, feature values, and provenance in every row.

Suggested benign families include known recipients, recurring payments, self-transfers, planned purchases, and crypto transfers without solicitation. Suspicious families include urgency, secrecy, impersonation, move-money-to-protect requests, guaranteed returns, advance fees, and unexpected crypto demands. Add contrast families such as a new recipient without coercive context and a large planned legitimate purchase.

## Minimal Feature Vector

Host-provided or derived numeric inputs:

- `is_new_recipient`
- `recipient_tx_count_log1p`
- `amount_to_recent_median_ratio`, clipped to `[0, 10]`
- `amount_to_spendable_ratio`, clipped to `[0, 3]`
- `context_present`

Optional semantic signals:

- `urgency`
- `secrecy_request`
- `guaranteed_or_high_return`
- `authority_or_known_person_impersonation`
- `unexpected_contact`
- `move_money_to_protect`
- `advance_fee_or_prize`
- `romance_or_online_only_relationship`
- `payment_method_demand`

Represent every optional semantic signal with both `value: 0 | 1` and `known: 0 | 1`. Missing context must not silently become false.

Do not use age, nationality, occupation, language, device price, or wallet type as risk proxies. On-chain transfer alone must not imply scam.

## LLM Boundary

```text
free-text context
→ LLM extracts allowed flags, evidence span, and confidence
→ deterministic validation
→ fixed feature vector
→ logistic-regression risk score
```

- Structured host data overrides LLM extraction.
- Unsupported or low-confidence extraction becomes unknown.
- No free-form LLM score enters the classifier.
- The system must run with no semantic context when U-Bot is unavailable.
- Provenance values are `host_provided`, `user_provided`, `llm_extracted`, `derived`, `simulated`, or `unavailable`.

## Preprocessing

- Leave binary features unchanged.
- Apply `log1p` to recipient transaction count before standardization.
- Standardize continuous features using training-set mean and scale only.
- Commit the fitted means, scales, and clips in the model artifact.
- Use a pipeline during training to prevent preprocessing leakage.

## Validation

Use the predefined family split. `StratifiedGroupKFold` is an acceptable secondary check when grouping by `scenario_family_id`.

Report:

- Confusion matrix
- Suspicious-class precision and recall
- F2 score
- Average precision
- False-negative scenario-family list
- Rule-baseline comparison

Select thresholds on validation only:

- `review`: achieve at least 0.95 recall, then maximize precision.
- `high`: achieve at least 0.80 precision, then maximize recall.
- Require `review < high`; otherwise use one warning threshold.

Evaluate frozen thresholds once on the test split. Never auto-block a payment.

## Interpretation

Call the sigmoid output a **model risk score**, not the probability that a transaction is a scam. Synthetic prevalence and scenario labels cannot establish real-world calibration, fairness, or production accuracy.

## Reproducibility

- Pin Python, NumPy, pandas, and scikit-learn versions.
- Fix generator and model seeds at `42`.
- Commit scenario-family definitions, generated CSV, split assignments, and training script.
- Export SHA-256 hashes for the dataset and family source.
- Store package versions and held-out metrics in the JSON artifact.
- Add golden vectors matching Python and TypeScript inference within `1e-9`.
- Do not deploy pickle or joblib artifacts.

## JSON Artifact Contract

```json
{
  "schemaVersion": 1,
  "modelType": "logistic_regression",
  "modelVersion": "risk-lr-2026-10-15.1",
  "positiveLabel": "suspicious_context",
  "featureOrder": ["is_new_recipient"],
  "transforms": {},
  "coefficients": [0.0],
  "intercept": 0.0,
  "link": "sigmoid",
  "thresholds": { "review": 0.0, "high": 0.0 },
  "training": {
    "seed": 42,
    "datasetSha256": "",
    "familySourceSha256": "",
    "sklearnVersion": "",
    "splitPolicy": "scenario_family_predefined"
  },
  "testMetrics": {
    "precision": 0.0,
    "recall": 0.0,
    "f2": 0.0,
    "averagePrecision": 0.0,
    "support": 0
  },
  "limitations": [
    "Synthetic curated demonstration data",
    "Risk score is not a real-world fraud probability",
    "Not validated for automatic blocking"
  ]
}
```

## Acceptance Gates

- Financial calculations do not import or call the ML classifier.
- Family-level test data is never used for fitting, preprocessing, or threshold selection.
- Exported-model TypeScript inference matches Python golden vectors within `1e-9`.
- Coefficient signs are reviewed for contradictions such as guaranteed returns lowering risk.
- The model meets or beats the fixed-rule baseline on the held-out families; otherwise the rules remain authoritative and ML is reported as experimental.

## Limitations to Present to Judges

- Synthetic data cannot prove production accuracy, calibration, fairness, or prevalence.
- The model can miss scam patterns absent from the curated families.
- Free-text signals depend on supplied context and extraction quality.
- New recipient and unusual amount are weak signals, not proof of wrongdoing.
- The result does not replace transaction authorization, KYC/AML, sanctions screening, or investigation.
- A real deployment requires representative labeled data, consent, monitoring, drift checks, override behavior, and regulatory review.

## Source Provenance

- [scikit-learn LogisticRegression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html)
- [scikit-learn pipelines and getting started](https://scikit-learn.org/stable/getting_started)
- [scikit-learn grouped cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html)
- [scikit-learn precision-recall guidance](https://scikit-learn.org/stable/auto_examples/model_selection/plot_precision_recall.html)
- [scikit-learn decision-threshold tuning](https://scikit-learn.org/stable/auto_examples/model_selection/plot_tuned_decision_threshold.html)
- [scikit-learn probability calibration](https://scikit-learn.org/stable/modules/calibration.html)
- [scikit-learn model persistence](https://scikit-learn.org/stable/model_persistence.html)
- [FTC emergency scams](https://consumer.ftc.gov/articles/scammers-use-fake-emergencies-steal-your-money)
- [FTC cryptocurrency scams](https://consumer.ftc.gov/articles/what-know-about-cryptocurrency-scams)
- [Investor.gov investment scam guidance](https://www.investor.gov/protect-your-investments/fraud/protect-your-money)
