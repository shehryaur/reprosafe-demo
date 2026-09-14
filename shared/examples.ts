export type CaseKind = 'invoices' | 'csv';
export interface Example { id: CaseKind; title: string; description: string; source: string; patch: string; records: Record<string, unknown>[]; }

export const examples: Example[] = [
  {
    id: 'invoices', title: 'Invoice customer isolation',
    description: 'Customer IDs are case-sensitive. Each report must contain only its own invoices.',
    source: `def process(records):
    reports = {}
    for record in records:
        customer = record["customer_id"].lower()
        if customer not in reports:
            reports[customer] = {
                "customer_id": customer,
                "invoice_ids": [],
                "total_cents": 0,
            }
        reports[customer]["invoice_ids"].append(record["invoice_id"])
        reports[customer]["total_cents"] += record["amount_cents"]
    return list(reports.values())
`,
    patch: `def process(records):
    reports = {}
    for record in records:
        customer = record["customer_id"]
        if customer not in reports:
            reports[customer] = {
                "customer_id": customer,
                "invoice_ids": [],
                "total_cents": 0,
            }
        reports[customer]["invoice_ids"].append(record["invoice_id"])
        reports[customer]["total_cents"] += record["amount_cents"]
    return list(reports.values())
`,
    records: [
      { customer_id: 'ACCT-NOVA', invoice_id: 'INV-1042', amount_cents: 12500, name: 'Nora Martin', email: 'nora@north.example' },
      { customer_id: 'acct-nova', invoice_id: 'INV-1043', amount_cents: 8900, name: 'Evan Cole', email: 'evan@south.example' },
      { customer_id: 'ACCT-NOVA', invoice_id: 'INV-1044', amount_cents: 4500, name: 'Nora Martin', email: 'nora@north.example' },
    ],
  },
  {
    id: 'csv', title: 'Quoted CSV import',
    description: 'Import quoted names and integer amounts without losing records or changing values.',
    source: `def process(records):
    imported = []
    for record in records:
        parts = record["row"].split(",")
        imported.append({
            "name": parts[0].strip('"'),
            "amount_cents": int(parts[1]),
        })
    return imported
`,
    patch: `import csv
import io

def process(records):
    imported = []
    for record in records:
        parts = next(csv.reader(io.StringIO(record["row"])))
        imported.append({
            "name": parts[0],
            "amount_cents": int(parts[1]),
        })
    return imported
`,
    records: [
      { row: '"Martin, Nora",12500', reference: 'CUSTOMER-PRIVATE-1042' },
      { row: '"Evan Cole",8900', reference: 'CUSTOMER-PRIVATE-1043' },
    ],
  },
];

export const contractText: Record<CaseKind, string> = {
  invoices: 'Input: JSON array of {customer_id: string, invoice_id: unique string, amount_cents: nonnegative integer, name?: string, email?: string, notes?: string}. Customer IDs are case-sensitive. process(records) returns [{customer_id, invoice_ids: string[], total_cents: integer}]. Every customer must have exactly one report, every invoice exactly once and only under its exact original owner, and all totals must match. Returning no records fails.',
  csv: 'Input: JSON array of {row: string, reference?: string}. Each row is exactly two valid CSV columns: a name and a nonnegative integer amount in cents. process(records) returns [{name: string, amount_cents: integer}] in input order. Quoted delimiters and Unicode names must be preserved. No missing or added records.',
};
