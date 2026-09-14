# Public Retail Bug Demo

This folder is ready to put in your own GitHub repository. No account credentials are included.

## What Is Real

The records are adapted from real historical transactions in **Chen, D. (2015), Online Retail**, UCI Machine Learning Repository, [DOI 10.24432/C5BW33](https://doi.org/10.24432/C5BW33), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The published data uses customer IDs, not customer names or contact details. Do not describe it as a leaked customer database. It is already a public research dataset. Keep this attribution and provenance.json with any shared copy.

`source-excerpt.json` preserves the selected original columns with the workbook row number. `records.json` adapts descriptions and line amounts to the existing CSV contract. Descriptions are product names, not people's names. Amounts are GBP pence, although the generic contract names its output field `amount_cents`.

Selection: first 30 eligible comma-containing descriptions and first 30 ordinary descriptions, interleaved. The selection deliberately targets a known delimiter issue; it is not representative random sampling.

## What Is Demonstration Code

`buggy.py` is an intentionally incorrect importer written for this demo. It splits CSV on commas without respecting quotes. It is **not** the original retailer's software or a discovered vulnerability. `fixed.py` uses Python's csv reader and is a supplied reference fix, not an AI-generated result.

## GitHub Setup

1. On GitHub, create a repository named `reprosafe-demo`.
2. Choose **Add file > Upload files** and add the files in this folder. Keep README.md and provenance.json for attribution.
3. Commit to the new repository. Public is acceptable for these licensed demo files only.
4. In ReproSafe, open **Data sources > GitHub**.
5. Enter `your-account/reprosafe-demo`, choose the branch, and click **Browse files**.
6. Choose `buggy.py`. It is read into local memory; GitHub remains unchanged.
7. Choose `records.json` too, or use Supabase below for the same fixture.
8. Use the **Quoted CSV import** contract. The easiest start is to select that sidebar example before connecting.

## Supabase Setup

Use a new disposable demo project, not a production database.

1. In Supabase, open **SQL Editor > New query**.
2. Open `supabase-demo.sql`, review it, and run its contents in that project's editor.
3. It creates only a new `public.reprosafe_retail_demo` table and inserts the 60 public demo rows. It fails if the table name already exists. There is no DROP or overwrite.
4. Its RLS policy permits read access to these **public demo rows only**. Never reuse this public policy for private records.
5. Find the project's URL and publishable key in **Connect** or the project's API settings.
6. In ReproSafe, open **Data sources > Supabase**, enter them, and click **Connect Supabase**. Do not use the secret/service-role key.
7. Select `reprosafe_retail_demo`. Map `row` to `row`, and `reference` to `reference`. Leave filters empty and set the limit to 60.
8. Click **Read selected records**, then close the dialog.

This is a bounded read of table rows, not a backup or a zero-data-transfer operation. The input reaches the local app's memory. The app never sends database credentials into Wasmer.

## Auto Demo

1. Click **Auto**.
2. Select **Human review**, **Bundled demo fix (no AI)**, and local application.
3. Click **Start Auto**. Watch ordinary replacement lose the failure while structural replacement retains it.
4. After four checks pass, choose **Review & apply**, inspect the diff, approve, and click **Apply locally**.
5. A new `.local/applied/<run>/fixed.py` is saved. GitHub and Supabase do not change.

For no pauses, choose **Automatic for this run** and approve the scope checkbox. For a real model-generated proposal, configure Gemini first and choose **Gemini proposal** instead of the bundled fix. Human mode will pause to show the exact outgoing request. Generation may incur API charges; Google AI Pro alone is not a generation quota promise.

No AI is needed to retrieve inputs, run Wasmer, create replacements, or validate the supplied fix. Do not present the supplied fix as AI-generated.

## Reproduce The Measurements

Read `../../benchmark-results/COMPARISON.md` and `results.json` in the full app distribution. AWS figures are estimates from published rates, not measured AWS performance. Presidio's standard replacement operator is actually run locally with known field boundaries; custom operators are outside this baseline.
