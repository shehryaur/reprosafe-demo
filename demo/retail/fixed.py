import csv
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
