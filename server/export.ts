import { zipSync, strToU8 } from 'fflate';
import type { CaseView } from '../shared/types.ts';
import { contractText } from '../shared/examples.ts';
import { releaseErrors } from './candidates.ts';

export function exportBundle(session: CaseView): Uint8Array {
  if (!session.candidate || !session.preview || session.releaseErrors.length) throw new Error('Review an eligible synthetic artifact before exporting.');
  if (releaseErrors(session.source, session.records, session.candidate.records).length) throw new Error('The source does not pass the release policy.');
  const includePatch = Boolean(session.patch && session.validation?.length === 4 && session.validation.every(x => x.result.status === 'pass'));
  if (includePatch && releaseErrors(session.patch!, session.records, session.candidate.records).length) throw new Error('The patch contains a private value or credential. Remove it and validate again before exporting.');
  const verify = `import csv
import importlib
import io
import json
import sys

module = importlib.import_module(sys.argv[1] if len(sys.argv) > 1 else "main")
with open("input.json", encoding="utf-8") as f:
    records = json.load(f)
actual = module.process(records)
kind = ${JSON.stringify(session.kind)}
if kind == "invoices":
    expected = {}
    for record in records:
        key = record["customer_id"]
        row = expected.setdefault(key, {"customer_id": key, "invoice_ids": [], "total_cents": 0})
        row["invoice_ids"].append(record["invoice_id"])
        row["total_cents"] += record["amount_cents"]
    def normalized(rows):
        return sorted([{"customer_id": r["customer_id"], "invoice_ids": sorted(r["invoice_ids"]), "total_cents": r["total_cents"]} for r in rows], key=lambda r: r["customer_id"])
    assert normalized(actual) == normalized(list(expected.values())), "Customer isolation contract failed"
else:
    expected = []
    for record in records:
        row = next(csv.reader(io.StringIO(record["row"])))
        expected.append({"name": row[0], "amount_cents": int(row[1])})
    assert actual == expected, "CSV values contract failed"
print("All acceptance checks passed.")
`;
  const files: Record<string, Uint8Array> = {
    'main.py': strToU8(session.source), 'input.json': strToU8(JSON.stringify(session.candidate.records, null, 2)), 'verify.py': strToU8(verify),
    'model-request.json': strToU8(JSON.stringify(session.preview.payload, null, 2)),
    'model-request-meta.json': strToU8(JSON.stringify({ provider: session.preview.provider, model: session.preview.model, destination: session.preview.destination, hash: session.preview.hash }, null, 2)),
    'report.json': strToU8(JSON.stringify({ format: 'reprosafe/1', kind: session.kind, createdAt: new Date().toISOString(), contract: contractText[session.kind], failure: session.original?.code, strategy: session.candidate.strategy, approvalHash: session.preview.hash, validation: session.validation, limitation: 'Specific contract checks and field policy; not a general privacy or security guarantee.' }, null, 2)),
    'README.txt': strToU8('ReproSafe synthetic reproducer\n\nThis bundle contains approved source and synthetic input, not the original customer fixture. Review source before running. In an appropriate isolated Python environment:\n  python verify.py main\nThe original module is expected to fail. If fixed.py is included:\n  python verify.py fixed\nThis patch passed the checks in report.json. These tests do not certify arbitrary code.\n'),
  };
  if (includePatch) files['fixed.py'] = strToU8(session.patch!);
  return zipSync(files, { level: 6 });
}
