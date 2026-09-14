import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { createHash } from 'node:crypto';
import { examples } from '../shared/examples.ts';
import { runPython } from '../server/runner.ts';
import { candidates, privateMarkers, releaseErrors } from '../server/candidates.ts';
import { assess, validateRecords } from '../server/contracts.ts';
import type { Records, Execution } from '../shared/types.ts';

const root = process.cwd();
const records = validateRecords('csv', JSON.parse(readFileSync('demo/retail/records.json','utf8')));
const source = readFileSync('demo/retail/buggy.py','utf8');
const python = process.env.REPROSAFE_BENCHMARK_PYTHON || 'python';
const baselineProcessStart = performance.now();
const baselineRun = spawnSync(python,['scripts/presidio-baseline.py'],{encoding:'utf8',timeout:30_000,windowsHide:true});
if (baselineRun.status !== 0) throw new Error(`Presidio baseline could not run. Install the pinned benchmark requirements. ${baselineRun.stderr}`);
const baselineProcessMs = performance.now()-baselineProcessStart;
const baseline = JSON.parse(baselineRun.stdout) as {records:Records;metrics:Record<string,unknown>};
const oldFetch = globalThis.fetch; let blockedRequests = 0;
globalThis.fetch = (async () => { blockedRequests++; throw new Error('Benchmark network disabled'); }) as typeof fetch;
const runs: any[] = [];
const allExecutions: Execution[] = [];
async function execute(code: string, fixture: Records) {
  const start=performance.now(), execution=await runPython(code,fixture);
  const result=assess('csv',fixture,execution); allExecutions.push(execution);
  return {status:result.status,code:result.code,wallMs:performance.now()-start,resources:execution.resources};
}
try {
  const warmup = await execute('def process(records):\n    return []\n',[]);
  if (warmup.status === 'error') throw new Error('Wasmer warmup failed');
  for(let i=0;i<6;i++) {
    const input=records.slice(i*10,(i+1)*10), masked=validateRecords('csv',baseline.records.slice(i*10,(i+1)*10));
    const transformStart=performance.now(); const choices=candidates('csv',input); const transformMs=performance.now()-transformStart;
    const original=await execute(source,input); if(original.status!=='fail') throw new Error('Expected original failure for targeted fixture');
    // Alternate execution order to reduce systematic cache/order bias.
    const outputs: Record<string,any>={};
    for(const strategy of i%2 ? ['structure','presidio'] : ['presidio','structure']) outputs[strategy]=await execute(source,strategy==='structure'?choices[1].records:masked);
    const fixed=await execute(examples[1].patch,input);
    const markers=privateMarkers(input);
    const leaks=(value:Records)=>markers.filter(m=>JSON.stringify(value).includes(m)||JSON.stringify(value).includes(JSON.stringify(m).slice(1,-1))).length;
    runs.push({batch:i+1,records:input.length,commaDescriptions:5,original,presidio:{...outputs.presidio,preserved:outputs.presidio.status==='fail'&&outputs.presidio.code===original.code,knownOriginalStringsRemaining:leaks(masked)},reprosafe:{...outputs.structure,preserved:outputs.structure.status==='fail'&&outputs.structure.code===original.code,knownOriginalStringsRemaining:leaks(choices[1].records),releaseErrors:releaseErrors(source,input,choices[1].records),transformMs},fixed});
    console.log(`Batch ${i+1}: original ${original.code}; Presidio ${outputs.presidio.code}; ReproSafe ${outputs.structure.code}; fix ${fixed.status}`);
  }
} finally { globalThis.fetch=oldFetch; }
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.ceil((sorted.length-1)/2)])/2;};
const inputBytes=Buffer.byteLength(JSON.stringify(records));
const units=records.reduce((sum,r)=>sum+Math.max(3,Math.ceil([...JSON.stringify(r)].length/100)),0);
const report={
  measuredAt:new Date().toISOString(), environment:{os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,logicalCpus:cpus().length,ramGiB:totalmem()/1024**3,node:process.version,wasmer:'0.13.0'},
  dataset:{records:records.length,batches:6,uniqueBugFamilies:1,recordsSha256:createHash('sha256').update(readFileSync('demo/retail/records.json')).digest('hex'),sourceBytes:Buffer.byteLength(source),inputBytes,selection:'Six batches of ten, five comma descriptions per batch. Targeted test, not a random benchmark. Real public transaction data; deliberately buggy source.'},
  baseline:{product:'Presidio Anonymizer',...baseline.metrics,processWallMs:baselineProcessMs,preserved:runs.filter(r=>r.presidio.preserved).length,medianValidationWallMs:median(runs.map(r=>r.presidio.wallMs))},
  reprosafe:{preserved:runs.filter(r=>r.reprosafe.preserved).length,medianValidationWallMs:median(runs.map(r=>r.reprosafe.wallMs)),transformWallMs:runs.reduce((s,r)=>s+r.reprosafe.transformMs,0),knownOriginalStringsRemaining:runs.reduce((s,r)=>s+r.reprosafe.knownOriginalStringsRemaining,0),externalModelCalls:0},
  resources:{totalSandboxExecutions:allExecutions.length,totalSandboxUserCpuMs:allExecutions.reduce((s,e)=>s+(e.resources?.userCpuMs??0),0),totalSandboxSystemCpuMs:allExecutions.reduce((s,e)=>s+(e.resources?.systemCpuMs??0),0),maxSingleWorkerRssMiB:Math.max(...allExecutions.map(e=>(e.resources?.maxRssKiB??0)/1024)),scope:'Entire experiment: warmup + original, two replacement checks, fixed original per batch. Worker CPU/RSS include Python/Wasmer initialization; RSS excludes parent app. This is not total machine energy or a cloud comparison.'},
  aws:{measured:false,service:'Amazon Comprehend DetectPiiEntities',estimatedRequests:records.length,estimatedBillable100CharacterUnits:units,usdPerUnit:0.0001,estimatedApiUsd:units*0.0001,pricingSource:'https://aws.amazon.com/comprehend/pricing/',assumptions:'One serialized record per request; max(3,ceil(characters/100)); published example rate, before free tier, taxes, storage and transfer. This estimates PII detection only, not bug reproduction. Actual AWS accuracy, CPU, memory, latency and cost were not measured.'},
  limits:['Presidio was given exact field spans and its standard replace operator; no Analyzer/NLP model. Custom Presidio operators could preserve delimiters.','Both replacements run locally with zero model calls; ReproSafe is not uniquely local or universally cheaper.','A fixed demonstration patch is supplied, not AI-generated. No real model request was benchmarked.','Six cases share one known delimiter bug family. Results do not establish general privacy, security, speed or superiority over AWS.','Zero known marker matches is a limited scan, not an anonymization guarantee.'],
  blockedParentNetworkAttempts:blockedRequests,runs,
};
mkdirSync('benchmark-results',{recursive:true}); writeFileSync('benchmark-results/results.json',JSON.stringify(report,null,2));
const md=`# Measured Comparison\n\nRun: ${report.measuredAt}\n\n## Results\n\n| Metric | Presidio standard replacement | ReproSafe structure replacement |\n|---|---:|---:|\n| Same failure retained | ${report.baseline.preserved}/6 | ${report.reprosafe.preserved}/6 |\n| Median one-candidate execution check | ${report.baseline.medianValidationWallMs.toFixed(1)} ms | ${report.reprosafe.medianValidationWallMs.toFixed(1)} ms |\n| Replacement transformation, 60 records | ${Number(baseline.metrics.transformWallMs).toFixed(3)} ms | ${report.reprosafe.transformWallMs.toFixed(3)} ms |\n| Model requests | 0 | 0 |\n\nPresidio version: ${baseline.metrics.version}. Both transformations were actually run. Presidio is a supplied-spans replacement baseline, not an NLP detection benchmark. Each replacement output was tested with the same code in the same Wasmer runtime.\n\nThe six fixtures come from 60 real UCI transactions selected for this one CSV delimiter bug family. They are not six independent real-world production bugs. The code is intentionally buggy demonstration code. Both replacement approaches changed amounts by the same deterministic rule.\n\n## Resource Measurements\n\nAcross the whole ${report.resources.totalSandboxExecutions}-execution experiment: ${(report.resources.totalSandboxUserCpuMs/1000).toFixed(3)} user CPU seconds; ${(report.resources.totalSandboxSystemCpuMs/1000).toFixed(3)} system CPU seconds; ${report.resources.maxSingleWorkerRssMiB.toFixed(1)} MiB highest individual worker peak RSS. Includes warmup, originals, both replacements, and fixed-code runs, not one app workflow. Parent app/browser memory, energy, download time and model generation are excluded. Presidio-only process peak RSS: ${(Number(baseline.metrics.peakProcessRssBytes)/1024**2).toFixed(1)} MiB, with no sandbox execution included; these memory figures are different scopes and must not be presented as equivalent.\n\nThe normal app preparation uses three executions (original + two candidates); a fix adds four validation executions. Extra validation has a real local compute cost. No claim that ReproSafe uses fewer resources than a redaction-only tool is supported.\n\n## AWS: Estimate, Not Measurement\n\nAt the rate in [AWS's Detect PII pricing example](https://aws.amazon.com/comprehend/pricing/), ${records.length} separate serialized-record requests total ${units} billable 100-character units: ${units} x $0.0001 = **$${(units*0.0001).toFixed(4)}** before free tier and other charges. Formula per request: max(3, ceil(characters / 100)). AWS may cost $0 under applicable free-tier allowances. AWS was not called; its latency, memory, CPU, detection quality, and bug retention are **not measured**.\n\nAWS Detect PII detects sensitive text, not a complete bug-reproduction workflow. ReproSafe is not a replacement for its coverage or managed service. For tiny inputs, API cost savings are not the main business case.\n\n## Defensible Claim\n\nOn this targeted quoted-delimiter test, execution-verified structural replacement retains the bug that standard replacement removes. That can reduce manual bug-report preparation, but developer-time savings have not been measured. Both tools support local processing. Presidio custom operators could implement similar replacements.\n\n## Sources And Reproduction\n\n- [Dataset and CC BY 4.0 attribution](https://archive.ics.uci.edu/dataset/352/online+retail); full adaptation details in demo/retail/provenance.json.\n- [Presidio standard and custom operators](https://presidio.dataprivacystack.org/anonymizer/).\n- [AWS Detect PII scope](https://docs.aws.amazon.com/ai/responsible-ai/comprehend-detectpii/overview.html).\n- Raw measurements: results.json. Set REPROSAFE_BENCHMARK_PYTHON to a Python executable; install scripts/benchmark-requirements.txt to .local/benchmark-deps; run node scripts/benchmark.ts.\n`;
writeFileSync('benchmark-results/COMPARISON.md',md+'\n## Measurement Caveat\n\nSingle-pass observations on a shared development machine, not controlled performance trials. Other development/test activity can affect timing. Do not turn timing differences into a general speed claim. A zero in a short CPU-time measurement may reflect timer granularity, not zero computation.\n');
console.log(JSON.stringify({preserved:{presidio:report.baseline.preserved,reprosafe:report.reprosafe.preserved},resources:report.resources,awsEstimate:report.aws.estimatedApiUsd}));
