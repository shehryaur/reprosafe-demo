def process(records):
    imported = []
    for record in records:
        parts = record["row"].split(",")
        imported.append({
            "name": parts[0].strip('"'),
            "amount_cents": int(parts[1]),
        })
    return imported
