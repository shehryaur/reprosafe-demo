import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import type { CaseKind } from '../shared/examples.ts';
import type { Records, Execution, Assessment } from '../shared/types.ts';

const id = z.string().min(1).max(160);
const invoice = z.object({ customer_id: id, invoice_id: id, amount_cents: z.number().int().min(0).max(1_000_000_000), name: z.string().max(300).optional(), email: z.string().max(300).optional(), notes: z.string().max(1500).optional() }).strict();
const csvRecord = z.object({ row: z.string().min(1).max(4000), reference: z.string().max(300).optional() }).strict();
export const inputSchema = z.object({
  title: z.string().trim().min(1).max(100), kind: z.enum(['invoices', 'csv']),
  source: z.string().min(10).max(24000), records: z.array(z.record(z.string(), z.unknown())).min(1).max(60),
}).strict();

export function parseCsvRow(row: string): [string, number] {
  const rows = parse(row, { bom: true, max_record_size: 4000 }) as string[][];
  if (rows.length !== 1 || rows[0].length !== 2 || !/^\d+$/.test(rows[0][1])) throw new Error('Each CSV row must contain exactly a name and a nonnegative integer amount.');
  const amount = Number(rows[0][1]);
  if (!Number.isSafeInteger(amount) || amount > 1_000_000_000) throw new Error('CSV amount is too large.');
  return [rows[0][0], amount];
}

export function validateRecords(kind: CaseKind, records: Records): Records {
  const parsed = z.array(kind === 'invoices' ? invoice : csvRecord).min(1).max(60).parse(records) as Records;
  if (kind === 'invoices' && new Set(parsed.map(r => r.invoice_id)).size !== parsed.length) throw new Error('Invoice IDs must be unique within the input.');
  if (kind === 'csv') for (const record of parsed) parseCsvRow(String(record.row));
  return parsed;
}

export function assess(kind: CaseKind, records: Records, execution: Execution): Assessment {
  const base = { checks: [] as {name: string; passed: boolean}[], durationMs: execution.durationMs };
  if (execution.state === 'timeout') return { ...base, status: 'error', code: 'TIMEOUT', label: 'Execution deadline exceeded' };
  if (execution.state === 'error') {
    const known = kind === 'csv' && execution.errorType === 'ValueError';
    return { ...base, status: known ? 'fail' : 'error', code: known ? 'CSV_PARSE_ERROR' : 'PYTHON_ERROR', label: known ? 'CSV amount parsing failed' : `Python execution failed (${execution.errorType || 'ExecutionError'})` };
  }
  if (!Array.isArray(execution.output)) return { ...base, status: 'fail', code: 'OUTPUT_SHAPE', label: 'Return value must be a JSON array' };
  if (kind === 'csv') {
    const expected = records.map(r => { const [name, amount_cents] = parseCsvRow(String(r.row)); return { name, amount_cents }; });
    const count = execution.output.length === expected.length;
    const values = count && execution.output.every((row, i) => row && row.name === expected[i].name && row.amount_cents === expected[i].amount_cents);
    const checks = [{ name: 'Every record returned', passed: count }, { name: 'Names, amounts and order preserved', passed: values }];
    return { ...base, checks, status: values ? 'pass' : 'fail', code: values ? 'PASS' : 'CSV_VALUES', label: values ? 'CSV contract passed' : 'Imported values do not match the input' };
  }
  const expected = new Map<string, { ids: string[]; total: number }>();
  const owners = new Map<string, string>();
  for (const r of records) {
    const customer = String(r.customer_id), invoiceId = String(r.invoice_id);
    const group = expected.get(customer) ?? { ids: [], total: 0 };
    group.ids.push(invoiceId); group.total += Number(r.amount_cents);
    expected.set(customer, group); owners.set(invoiceId, customer);
  }
  const shape = execution.output.every(r => r && typeof r === 'object' && typeof r.customer_id === 'string' && Array.isArray(r.invoice_ids) && r.invoice_ids.every((x: unknown) => typeof x === 'string') && Number.isSafeInteger(r.total_cents));
  if (!shape) return { ...base, status: 'fail', code: 'OUTPUT_SHAPE', label: 'Invoice report shape does not match the contract' };
  const rows = execution.output as { customer_id: string; invoice_ids: string[]; total_cents: number }[];
  const mixed = rows.some(row => new Set(row.invoice_ids.map(invoiceId => owners.get(invoiceId))).size > 1);
  const membership = rows.length === expected.size && new Set(rows.map(r => r.customer_id)).size === expected.size && rows.every(row => {
    const e = expected.get(row.customer_id);
    return e && JSON.stringify([...row.invoice_ids].sort()) === JSON.stringify([...e.ids].sort());
  });
  const totals = membership && rows.every(row => row.total_cents === expected.get(row.customer_id)!.total);
  const checks = [{ name: 'Customers kept separate', passed: !mixed }, { name: 'Every invoice under its exact owner', passed: membership }, { name: 'Totals preserved', passed: totals }];
  const code = mixed ? 'CUSTOMER_ISOLATION' : !membership ? 'INVOICE_MEMBERSHIP' : !totals ? 'INVOICE_TOTALS' : 'PASS';
  const labels: Record<string, string> = { CUSTOMER_ISOLATION: 'Invoices from different customers were merged', INVOICE_MEMBERSHIP: 'Invoices are missing, duplicated, or assigned to a changed customer ID', INVOICE_TOTALS: 'Invoice totals do not match', PASS: 'Customer isolation contract passed' };
  return { ...base, checks, status: code === 'PASS' ? 'pass' : 'fail', code, label: labels[code] };
}

export function regressionInputs(kind: CaseKind): { title: string; records: Records }[] {
  return kind === 'invoices' ? [
    { title: 'Repeated customer & separate customer', records: [{customer_id:'customer-a',invoice_id:'i1',amount_cents:120},{customer_id:'customer-a',invoice_id:'i2',amount_cents:80},{customer_id:'customer-b',invoice_id:'i3',amount_cents:45}] },
    { title: 'Case-sensitive IDs & zero amount', records: [{customer_id:'AbC',invoice_id:'i4',amount_cents:0},{customer_id:'abc',invoice_id:'i5',amount_cents:40}] },
  ] : [
    { title: 'Plain CSV & zero amount', records: [{row:'"Example Person",0'}, {row:'"Another Person",140'}] },
    { title: 'Quoted comma & escaped quote', records: [{row:'"Example, Person",120'},{row:'"A ""Quoted"" Name",75'}] },
  ];
}
