"""Measured standard replacement with known spans, not a PII-detection benchmark."""
import csv
import io
import json
import pathlib
import sys
import time
import importlib.metadata

root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.local' / 'benchmark-deps'))
import psutil
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import RecognizerResult, OperatorConfig

records = json.loads((root / 'demo' / 'retail' / 'records.json').read_text(encoding='utf-8'))
engine = AnonymizerEngine()
process = psutil.Process()
cpu_start = time.process_time()
started = time.perf_counter()
output = []
for i, record in enumerate(records):
    description = next(csv.reader([record['row']]))[0]
    # Both approaches know the field boundaries. No NLP model is loaded.
    replacement = engine.anonymize(text=description, analyzer_results=[RecognizerResult(entity_type='PRIVATE_FIELD', start=0, end=len(description), score=1.0)], operators={'PRIVATE_FIELD':OperatorConfig('replace', {'new_value':f'Example Person {i % 10 + 1}'})}).text
    reference = engine.anonymize(text=record['reference'], analyzer_results=[RecognizerResult(entity_type='PRIVATE_FIELD',start=0,end=len(record['reference']),score=1.0)],operators={'PRIVATE_FIELD':OperatorConfig('replace',{'new_value':f'synthetic-ref-{i % 10 + 1}'})}).text
    buffer = io.StringIO(newline='')
    csv.writer(buffer, quoting=csv.QUOTE_ALL, lineterminator='\n').writerow([replacement, 170 + (i % 10) * 83])
    output.append({'row':buffer.getvalue().rstrip('\n'), 'reference':reference})
# Amounts must remain unquoted for the intentionally naive baseline importer.
# Quote only the text field exactly as ReproSafe does, using csv parsing above.
for record in output:
    name, amount = next(csv.reader([record['row']]))
    record['row'] = '"' + name.replace('"','""') + '",' + amount
metrics = {'version':importlib.metadata.version('presidio-anonymizer'), 'records':len(records),'transformWallMs':(time.perf_counter()-started)*1000,'transformCpuMs':(time.process_time()-cpu_start)*1000,'peakProcessRssBytes':getattr(process.memory_info(),'peak_wset',process.memory_info().rss),'modelCalls':0,'networkRequests':0,'scope':'Presidio standard replace operator with supplied exact field spans. Includes CSV adaptation; excludes Python/import startup and bug execution. Not a detection-accuracy test.'}
print(json.dumps({'records':output,'metrics':metrics}))
