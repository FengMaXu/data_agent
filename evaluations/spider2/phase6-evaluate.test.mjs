import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPhase6Report, clusteredBootstrap } from "./phase6-evaluate.mjs";

test("clustered bootstrap samples instance clusters and is deterministic", () => {
  const input={a:1,b:0,c:-1,d:1};
  const first=clusteredBootstrap(input,2000,7);
  const second=clusteredBootstrap(input,2000,7);
  assert.deepEqual(first,second);
  assert.equal(first.clusters,4);
  assert.equal(first.point,0.25);
  assert.ok(first.lower<=first.point&&first.upper>=first.point);
});

test("clustered bootstrap does not treat repetitions as independent cases", () => {
  const result=clusteredBootstrap({caseA:0.5,caseB:-0.5},1000,9);
  assert.equal(result.clusters,2);
  assert.equal(result.point,0);
});

test("Phase 6 report validates three paired repetitions and separates architecture from ablation", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"phase6-report-"));
  const labels=path.join(root,"labels.jsonl"), thresholds=path.join(root,"thresholds.json");
  await writeFile(labels,JSON.stringify({instanceId:"a",annotationStatus:"adjudicated",review:{annotators:["x","y"],adjudicator:"z"},facets:{ambiguity:{alternatives:[{}]}}})+"\n");
  await writeFile(thresholds,JSON.stringify({dataset:{repetitions:3,holdoutSize:1},semantic:{minimumAnnotators:2},architecture:{maximumIdentifiedAdoptedUnconfirmedDisclosureMissRate:0,minimumPairedE2EDifferenceCiLower:-.03,maximumCoverageDrop:.02,maximumMeanToolCallIncrease:.15,maximumMeanTokenCostIncrease:.15,maximumP95LatencyIncrease:.2}}));
  const make=async(name,correct,predicted,published=true)=>{const dir=path.join(root,name);await mkdir(path.join(dir,"cases","a","workspace"),{recursive:true});await mkdir(path.join(dir,"official_score"),{recursive:true});const manifest={instanceIds:["a"],datasetSha256:"d",model:"m",limits:{maxTurns:20},concurrency:1};await writeFile(path.join(dir,"manifest.json"),JSON.stringify(manifest));await writeFile(path.join(dir,"official_score","summary.json"),JSON.stringify({execResult:{caseScores:{a:correct}}}));await writeFile(path.join(dir,"cases","a","result.json"),JSON.stringify({status:"completed",durationMs:10,turns:2,toolCalls:3,publicationStatus:published?"published_with_disagreement":"not_published_no_export_call",finalSql:published?{}:null,csvGenerated:published}));const hypotheses=published?[]:[{id:"H1",status:"candidate"}];await writeFile(path.join(dir,"cases","a","trace.json"),JSON.stringify({events:[],toolCalls:predicted?[{toolName:"update_answer_spec",args:{decisionProposals:[{materiality:"material"}],hypotheses}}]:[],assuranceAuditRecords:[]}));return dir;};
  const legacy=[],off=[],on=[];for(let i=0;i<3;i++){legacy.push(await make(`l${i}`,0,false));off.push(await make(`o${i}`,1,false));on.push(await make(`n${i}`,1,true,false));}
  const report=await buildPhase6Report({legacyPaths:legacy,newOffPaths:off,newOnPaths:on,labelsPath:labels,thresholdsPath:thresholds});
  assert.equal(report.metrics.legacy.observations,3);assert.equal(report.metrics.newOn.ambiguity.recall,1);assert.equal(report.metrics.newOn.disclosure.identifiedAdoptedUnconfirmed,0);assert.equal(report.metrics.newOn.disclosure.misses,0);assert.equal(report.ablation.correctnessChange,0);assert.equal(report.architecture.e2eDifferenceCi.clusters,1);
});
