"""Extract a bounded, attributed transaction fixture; never use customer contact data."""
import csv
import hashlib
import io
import json
import pathlib
import urllib.request
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
import openpyxl

root = pathlib.Path(__file__).resolve().parents[1]
cache = root / '.local' / 'datasets'
cache.mkdir(parents=True, exist_ok=True)
archive = cache / 'online-retail.zip'
url = 'https://archive.ics.uci.edu/static/public/352/online+retail.zip'
if not archive.exists():
    request = urllib.request.Request(url, headers={'User-Agent': 'ReproSafe-demo/1.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read(30_000_001)
    if len(data) > 30_000_000:
        raise ValueError('Dataset archive exceeds the size limit')
    archive.write_bytes(data)
with zipfile.ZipFile(archive) as zipped:
    with zipped.open('Online Retail.xlsx') as file:
        workbook = openpyxl.load_workbook(file, read_only=True, data_only=True)
        sheet = workbook.active
        rows = sheet.iter_rows(values_only=True)
        headers = next(rows)
        commas, plain = [], []
        for row_number, values in enumerate(rows, start=2):
            row = dict(zip(headers, values))
            description = row.get('Description')
            if not isinstance(description, str) or not row.get('CustomerID') or not row.get('Quantity') or row.get('UnitPrice') is None:
                continue
            amount = Decimal(str(row['UnitPrice'])) * Decimal(str(row['Quantity'])) * 100
            if amount < 0 or amount > 1_000_000_000:
                continue
            item = {key: value.isoformat() if isinstance(value, datetime) else value for key, value in row.items()}
            item['source_row'] = row_number
            item['line_total_pence'] = int(amount.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
            target = commas if ',' in description else plain
            if len(target) < 30:
                target.append(item)
            if len(commas) == 30 and len(plain) == 30:
                break
        workbook.close()
if len(commas) != 30 or len(plain) != 30:
    raise ValueError('Expected 30 comma descriptions and 30 controls')
selected = [item for pair in zip(commas, plain) for item in pair]
records = []
for row in selected:
    buffer = io.StringIO(newline='')
    csv.writer(buffer, lineterminator='\n').writerow([row['Description'], row['line_total_pence']])
    records.append({'row': buffer.getvalue().rstrip('\n'), 'reference': f"customer-{int(row['CustomerID'])}/invoice-{row['InvoiceNo']}/line-{row['source_row']}"})
out = root / 'demo' / 'retail'
out.mkdir(parents=True, exist_ok=True)
(out / 'records.json').write_text(json.dumps(records, indent=2, ensure_ascii=True) + '\n', encoding='utf-8')
(out / 'source-excerpt.json').write_text(json.dumps(selected, indent=2, ensure_ascii=True) + '\n', encoding='utf-8')
manifest = {
    'dataset': 'Chen, D. (2015). Online Retail. UCI Machine Learning Repository.',
    'doi': 'https://doi.org/10.24432/C5BW33',
    'source': 'https://archive.ics.uci.edu/dataset/352/online+retail',
    'download': url,
    'license': 'CC BY 4.0',
    'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
    'retrievedAt': datetime.now(timezone.utc).isoformat(),
    'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'recordsSha256': hashlib.sha256((out / 'records.json').read_bytes()).hexdigest(),
    'selection': 'First 30 eligible comma-containing descriptions and first 30 without commas, interleaved. Positive/zero non-cancelled line amounts with CustomerID. Targeted selection, not random sampling.',
    'adaptation': 'Description becomes CSV first column; round-half-up Quantity * UnitPrice * 100 becomes integer pence. The existing contract calls this amount_cents/name but these values are GBP pence/product descriptions, not personal names. CustomerID, InvoiceNo and source row form reference.',
    'code': 'buggy.py is an intentionally incorrect demonstration importer written for ReproSafe, not a bug found in the original retailer software.',
    'rows': len(records), 'commaRows': len(commas), 'plainRows': len(plain),
}
(out / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
sql_values = ',\n'.join("('%s', '%s')" % (record['row'].replace("'", "''"), record['reference'].replace("'", "''")) for record in records)
sql = """-- PUBLIC LICENSED DEMO DATA ONLY. Do not use this policy for private customer tables.
-- Chen, D. (2015), Online Retail, UCI, CC BY 4.0; see provenance.json.
-- Creates a new table; fails if the name exists. Does not modify an existing table.
begin;
create table public.reprosafe_retail_demo (
    id bigint generated always as identity primary key,
    row text not null,
    reference text not null
);
alter table public.reprosafe_retail_demo enable row level security;
revoke all on public.reprosafe_retail_demo from anon, authenticated;
grant select on public.reprosafe_retail_demo to anon, authenticated;
create policy \"Public licensed demo read\" on public.reprosafe_retail_demo
    for select to anon, authenticated using (true);
insert into public.reprosafe_retail_demo (row, reference) values
""" + sql_values + ';\ncommit;\n'
(out / 'supabase-demo.sql').write_text(sql, encoding='utf-8')
print(json.dumps({'rows': len(records), 'commaRows': len(commas), 'firstCommaDescription': commas[0]['Description'], 'sha256': manifest['recordsSha256']}))
