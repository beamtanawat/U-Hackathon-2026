# Archay Risk Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reusable, tested Safe-to-Pay contract, deterministic financial engine, and explainable scam-context risk model for the U-HANDSHAKE integration preview.

**Architecture:** Root TypeScript library files expose the shared contract and deterministic inference consumed later by Next.js. Python is used only offline to generate curated synthetic data and train logistic regression. The deployed artifact is plain JSON; no Python server is required.

**Tech Stack:** TypeScript, Zod, Vitest, Python 3, pandas, scikit-learn.

**Spec:** [Application Direction](https://app.notion.com/p/3fa5a0f7b3a18046911ef66fac9d21ec?pvs=204)

**Recipe:** [ML training recipe](../../../outputs/ml-training-recipe.md)

## Global Constraints

- Financial math is deterministic and independent from ML/LLM.
- The model predicts `suspicious_context`, never confirmed fraud.
- Every optional input records provenance and missing is not false.
- Use fictional curated data only; no real U-Topia account data.
- Output is a risk score, not a calibrated fraud probability.
- No UI, API route, database, Python service, ONNX, SHAP, or tree model.

## Task 1: Shared Contract and Validation

**Files:** `package.json`, `tsconfig.json`, `lib/domain/types.ts`, `lib/domain/schemas.ts`, `tests/unit/domain-schemas.test.ts`

- [ ] Create minimal TypeScript/Vitest/Zod package configuration.
- [ ] Write failing schema tests for valid U-Tag/Crypto requests, negative money, missing provenance, and unknown optional semantic flags.
- [ ] Run `npm test -- tests/unit/domain-schemas.test.ts` and verify failure is caused by missing implementation.
- [ ] Implement the smallest types and Zod schemas that pass.
- [ ] Run the focused test and full `npm test`.
- [ ] Commit `feat: define safety evaluation contract`.

## Task 2: Deterministic Safe-to-Pay Engine

**Files:** `lib/engine/safe-to-pay.ts`, `data/scenarios.ts`, `tests/unit/safe-to-pay.test.ts`

- [ ] Write failing tests for Safe, Review, High Risk, exact boundary, negative post-balance, and missing-data behavior.
- [ ] Verify RED with `npm test -- tests/unit/safe-to-pay.test.ts`.
- [ ] Implement safe-to-spend, post-transaction values, status, affected commitments, and reason codes without ML.
- [ ] Add the three canonical fictional scenarios.
- [ ] Verify focused and full suites.
- [ ] Commit `feat: add deterministic safe-to-pay engine`.

## Task 3: Curated Dataset and Offline Training

**Files:** `ml/scenario-families.json`, `ml/generate_dataset.py`, `ml/train.py`, `ml/requirements.txt`, `ml/training-data.csv`, `lib/ml/model.json`

- [ ] Create family definitions with benign, suspicious, contrast, and challenge scenarios; keep each family in one split.
- [ ] Add an assert-based generator self-check for unique case IDs, valid labels/splits, and no family leakage; run it before generation and observe failure until definitions are valid.
- [ ] Generate the CSV deterministically with seed 42.
- [ ] Train the fixed logistic-regression recipe and fixed-rule baseline.
- [ ] Select thresholds on validation only and evaluate frozen thresholds once on test.
- [ ] Export full-precision coefficients, transforms, thresholds, hashes, versions, metrics, limitations, and golden vectors.
- [ ] Run training twice and verify identical hashes/artifact output.
- [ ] Commit `feat: train explainable scam-context baseline`.

## Task 4: Deterministic TypeScript Inference

**Files:** `lib/ml/extract-features.ts`, `lib/ml/risk-classifier.ts`, `tests/unit/risk-classifier.test.ts`

- [ ] Write failing tests for golden-vector parity, missing-context knownness, band thresholds, provenance, and invalid artifacts.
- [ ] Verify RED with `npm test -- tests/unit/risk-classifier.test.ts`.
- [ ] Implement only artifact validation, transforms, sigmoid inference, band selection, and contributing indicators.
- [ ] Verify Python/TypeScript scores within `1e-9`.
- [ ] Run `npm test` and the reproducible training command.
- [ ] Commit `feat: add deterministic risk model inference`.

## Review Focus

- Can malformed or missing data accidentally become a low-risk result?
- Are financial and trust outputs technically independent?
- Does any real account data or unconfirmed U-Topia field appear?
- Is every model claim honest about synthetic data and calibration?
- Can Ete and Beam consume the contract without Python?
