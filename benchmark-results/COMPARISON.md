# Measured Comparison

Run: 2026-09-13T22:40:56.450Z

## Results

| Metric | Presidio standard replacement | ReproSafe structure replacement |
|---|---:|---:|
| Same failure retained | 0/6 | 6/6 |
| Median one-candidate execution check | 10181.8 ms | 8619.9 ms |
| Replacement transformation, 60 records | 35.949 ms | 10.528 ms |
| Model requests | 0 | 0 |

Presidio version: 2.2.364. Both transformations were actually run. Presidio is a supplied-spans replacement baseline, not an NLP detection benchmark. Each replacement output was tested with the same code in the same Wasmer runtime.

These are single-pass observations on a shared development machine, not controlled performance trials. Other development/test activity can affect timing. Do not turn the timing difference into a general speed claim. Resource scopes differ as described below.

A zero in a short CPU-time measurement may reflect timer granularity, not zero computation.

The six fixtures come from 60 real UCI transactions selected for this one CSV delimiter bug family. They are not six independent real-world production bugs. The code is intentionally buggy demonstration code. Both replacement approaches changed amounts by the same deterministic rule.

## Resource Measurements

Across the whole 25-execution experiment: 253.568 user CPU seconds; 15.928 system CPU seconds; 558.5 MiB highest individual worker peak RSS. Includes warmup, originals, both replacements, and fixed-code runs, not one app workflow. Parent app/browser memory, energy, download time and model generation are excluded. Presidio-only process peak RSS: 26.7 MiB, with no sandbox execution included; these memory figures are different scopes and must not be presented as equivalent.

The normal app preparation uses three executions (original + two candidates); a fix adds four validation executions. Extra validation has a real local compute cost. No claim that ReproSafe uses fewer resources than a redaction-only tool is supported.

## AWS: Estimate, Not Measurement

At the rate in [AWS's Detect PII pricing example](https://aws.amazon.com/comprehend/pricing/), 60 separate serialized-record requests total 180 billable 100-character units: 180 x $0.0001 = **$0.0180** before free tier and other charges. Formula per request: max(3, ceil(characters / 100)). AWS may cost $0 under applicable free-tier allowances. AWS was not called; its latency, memory, CPU, detection quality, and bug retention are **not measured**.

AWS Detect PII detects sensitive text, not a complete bug-reproduction workflow. ReproSafe is not a replacement for its coverage or managed service. For tiny inputs, API cost savings are not the main business case.

## Defensible Claim

On this targeted quoted-delimiter test, execution-verified structural replacement retains the bug that standard replacement removes. That can reduce manual bug-report preparation, but developer-time savings have not been measured. Both tools support local processing. Presidio custom operators could implement similar replacements.

## Sources And Reproduction

- [Dataset and CC BY 4.0 attribution](https://archive.ics.uci.edu/dataset/352/online+retail); full adaptation details in demo/retail/provenance.json.
- [Presidio standard and custom operators](https://presidio.dataprivacystack.org/anonymizer/).
- [AWS Detect PII scope](https://docs.aws.amazon.com/ai/responsible-ai/comprehend-detectpii/overview.html).
- Raw measurements: results.json. Set REPROSAFE_BENCHMARK_PYTHON to a Python executable; install scripts/benchmark-requirements.txt to .local/benchmark-deps; run node scripts/benchmark.ts.
