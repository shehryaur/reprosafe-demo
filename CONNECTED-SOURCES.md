# Connected Sources And Auto

## Open The Updated App

On this machine: http://127.0.0.1:4319/ . Older instances remain separate, including their keys. Enter your Gemini key in the updated instance's Settings when you need a real AI proposal. Never put keys into GitHub, SQL demo files, or chat.

## Fastest Demonstration

1. Click **Data sources**.
2. Click **Open public retail demo**. This reads the bundled licensed transaction excerpt locally.
3. Click **Auto**.
4. Choose **Human review** and **Bundled demo fix (no AI)**.
5. Leave **Apply validated fix to a new local fixed.py** checked. Click **Start Auto**.
6. Wait for the original execution, two candidate checks, and four patch checks. This runtime currently has noticeable startup overhead; allow roughly a minute or longer on this machine.
7. Click **Review & apply**. Review the diff, check the approval box, and click **Apply locally**.
8. The result displays the saved path. The original file and all remote services are unchanged.

For no approval pauses, select **Automatic for this run** and check the scope consent. For a real AI fix, configure a model and select **Gemini proposal**. A bundled fix is not AI-generated. Prepare-only does not request or apply any fix.

## GitHub And Supabase Demo

Follow [the exact setup and upload steps](demo/retail/README.md). The source/data/SQL files are in `demo/retail`; there is also a separate demo ZIP in the output folder.

GitHub can supply `buggy.py` and optionally `records.json`. Supabase can supply the same input through `reprosafe_retail_demo`. Select **Quoted CSV import** in the sidebar before reading this dataset through the connections. Supabase is a table picker in this version, not a Storage bucket/file browser.

Once files/rows are selected, **Auto** offers **Refresh the selected connected files and rows before running**. This re-reads those same selections, not the whole repository/database. Turning it off uses the current local snapshot. Editing the source/input manually clears that input's connection binding. Reloading the page clears bindings; disconnecting removes the server-held credential. A GitHub branch selection can be pinned to the commit shown by **Load branches**.

Both pickers use APIs, not embedded provider websites. Account setup is not two clicks; subsequent runs avoid manual file downloads/uploads. GitHub repository/branch lists are capped at 100; enter a repository or ref directly if needed. Directory listings are subject to GitHub's limit. Source must still fit the one-module, standard-library Python contract (24,000 characters); input is at most 60 records.

## Private Company Data

Do not use the demo's public-read SQL policy for private tables. Have the project owner configure SELECT grants and RLS for only the approved rows/columns. Use a dedicated restricted view or role if appropriate, and review its security behavior. The app cannot certify your database permissions. It refuses service-role/admin tokens and only performs GET reads, but an anon/publishable key alone does not make data private.

Credentials stay in the local host process and are not given to Wasmer. Selected records and source enter local memory. No original fixture is included in the model request, but source code and structural information can still be sensitive. Keep human review enabled for private work. Applied files remain on disk until you remove them; stopping the server only clears in-memory keys/cases.

No extension, scheduled monitoring, automated PR merge, production deployment, or database write was added. These are deliberately outside the consent and permission scope of the read-only connectors.

## Numbers You Can Show

Read [COMPARISON.md](benchmark-results/COMPARISON.md). It includes measured results, resources, methodology and limitations, with machine-readable measurements alongside it.

The benchmark is a targeted six-batch comparison from one known CSV bug family. Presidio's standard replacement engine is genuinely executed; its customizable operators are not ruled out. AWS was not benchmarked: the report includes only a clearly labeled cost estimate using its published Detect PII rate. Do not claim general superiority, measured developer-hours saved, or universal privacy.

## Verification Commands

```powershell
npm test
npm run build
node tests/connected-integration.ts
node tests/model-auto-integration.ts
```

The connected integration uses the public dataset and a bundled fix. The model integration mocks Google's HTTP response and sends no live model request. Live private repositories and Supabase projects require your authorized credentials and existing policies. `scripts/check-connected-ui.mjs` is a machine-local Playwright check using the bundled desktop runtime.
