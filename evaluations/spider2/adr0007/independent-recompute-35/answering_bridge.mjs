// Offline analyst CLI over the real Answering tools: set -> execute -> publish.
// Does not use a model provider, evaluation Gold as runtime evidence, or disabled qualification.
import {readFile,writeFile,mkdir,appendFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {TODO_CONTEXT} from '@earendil-works/pi-agent-core';
import {InMemoryAnswering} from '../../../../packages/runtime/dist/answering/service.js';
import {InMemoryAnsweringStore} from '../../../../packages/runtime/dist/answering/answering-store.js';
import {FileResultStore} from '../../../../packages/runtime/dist/answering/result-store.js';
import {createAnsweringAgentToolDefinitions} from '../../../../packages/runtime/dist/tools/answering.js';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const [id,op,file]=process.argv.slice(2);
if(!/^local\d{3}$/.test(id??'') || !['set','query','final','inspect','freeze','reveal'].includes(op)) throw new Error('Usage: node answering_bridge.mjs localNNN set|query|final|inspect|freeze|reveal [input.json]');
const dir=path.join(HERE,'cases',id);
const packet=JSON.parse(await readFile(path.join(dir,'blind.json'),'utf8'));
const snapPath=path.join(dir,'answering-state.json');
let snap;
try {snap=JSON.parse(await readFile(snapPath,'utf8'));} catch(e) {if(e.code!=='ENOENT')throw e;}
const store=new InMemoryAnsweringStore(snap);
const resultStore=new FileResultStore(path.join(dir,'private-results'));
const invocationId=randomUUID();
const context={principal:{id:'independent-analyst'},sessionId:id,lane:'main',operationId:'independent-recompute',invocationId};
let taskId=snap?.tasks?.[0]?.taskId;
const toolContext={principalId:context.principal.id,sessionId:id,requestMessageId:'original-task',lane:'main'};
const invocation={invocationId,operationId:context.operationId,turnId:invocationId,getMemo:async()=>undefined,setMemo:async()=>undefined};
const executor={dialect:'sqlite',run:async(sql,limit,options)=>{
  if(!taskId)throw new Error('Answer Spec must exist before any SQL');
  if(!packet.database_path)throw new Error('DATABASE_UNAVAILABLE');
  const payload={database:packet.database_path,sql,limit};
  const child=spawn('python',[path.join(HERE,'sqlite_readonly.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});
  let out='',err='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  const timer=setTimeout(()=>child.kill(),130000);
  child.stdin.end(JSON.stringify(payload));
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  clearTimeout(timer);
  if(code!==0)throw new Error(err||`SQLite process exited ${code}`);
  const raw=JSON.parse(out);
  await appendFile(path.join(dir,'executor-events.jsonl'),JSON.stringify({occurredAt:new Date().toISOString(),invocationId,taskId,kind:options.kind,sql,limit,raw})+'\n','utf8');
  return raw;
}};
const docs=packet.documents;
const answering=new InMemoryAnswering({store,resultStore,sqlExecutor:executor,fieldProbes:true,populationDecisions:'allow_disclosed',requireAdvice:false,fanout:{enabled:false},budgetPolicy:{version:'answering-dual-loop-v1',maxRevisions:40,maxExplorationAttempts:120,maxResultAttempts:20,maxElapsedMs:4*60*60*1000,maxObservedRows:2000000},evidenceSource:{readUserMessage:async(session,message)=>session===id&&message==='original-task'?packet.question:undefined,readDocument:async(ref)=>{const doc=docs[ref];return doc?{kind:'task_document',content:doc.content}:undefined;}}});
const tools=createAnsweringAgentToolDefinitions(answering,{resolve:async(receiptId)=>{const task=await answering.inspect({taskId},context);const receipt=task.publication;if(!receipt||receipt.receiptId!==receiptId)throw new Error('Receipt is not current');await resultStore.openAuthorized(receipt.resultRef,receipt,context);return resultStore.encodeCsv(receipt.resultRef,context);}}).map(definition=>definition.tool);
async function call(name,args){
  const tool=tools.find(t=>t.name===name);
  if(!tool)throw new Error(`Tool not registered: ${name}`);
  try {
    const response=await tool.execute(invocationId,args,undefined,toolContext,invocation,TODO_CONTEXT);
    if(response.details?.taskId)taskId=response.details.taskId;
    const event={occurredAt:new Date().toISOString(),invocationId,tool:name,args,response};
    await appendFile(path.join(dir,'tool-events.jsonl'),JSON.stringify(event)+'\n','utf8');
    await writeFile(snapPath,JSON.stringify(store.snapshot(),null,2),'utf8');
    return response;
  } catch(e) {
    await appendFile(path.join(dir,'tool-events.jsonl'),JSON.stringify({occurredAt:new Date().toISOString(),invocationId,tool:name,args,error:{message:e.message,code:e.code,details:e.details}})+'\n','utf8');
    await writeFile(snapPath,JSON.stringify(store.snapshot(),null,2),'utf8');
    throw e;
  }
}
let input=file?JSON.parse(await readFile(path.resolve(file),'utf8')):{};
let response;
try {
  if(op==='set')response=await call('set_answer_spec',{...(taskId?{taskId}:{}),fields:input.fields??input});
  else if(op==='inspect') {if(!taskId)throw new Error('No task');response=await call('inspect_answer',{taskId});}
  else if(op==='query'||op==='final') {
    if(!taskId)throw new Error('No Answer Spec; call set first');
    const view=await answering.inspect({taskId},context);
    response=await call('query_database',{kind:op==='final'?'result':'exploration',taskId,...(op==='final'?{revisionId:view.task.currentRevisionId}:{}),...input});
    if(op==='final'&&response.details?.artifact?.kind==='candidate') {
      const candidateId=response.details.artifact.candidateId;
      const receiptResponse=await call('export_query',{candidateId,format:'csv'});
      const receipt=receiptResponse.details;
      await resultStore.openAuthorized(receipt.resultRef,receipt,context);
      const csv=await resultStore.encodeCsv(receipt.resultRef,context);
      const pubDir=path.join(dir,'publications',receipt.receiptId);await mkdir(pubDir,{recursive:true});
      await writeFile(path.join(pubDir,'result.csv'),csv.content,'utf8');
      await writeFile(path.join(pubDir,'query.sql'),input.sql+'\n','utf8');
      await writeFile(path.join(pubDir,'receipt.json'),JSON.stringify(receipt,null,2),'utf8');
      response={query:response,publication:receiptResponse,authorizedCsv:path.join(pubDir,'result.csv')};
    }
  } else if(op==='freeze') {
    if(!taskId)throw new Error('No Answer Spec');
    const frozenPath=path.join(dir,'independent-freeze.json');
    try {await access(frozenPath);throw new Error('Independent freeze is immutable');}catch(e){if(e.code!=='ENOENT')throw e;}
    const view=await answering.inspect({taskId},context);
    if(!view.publication)throw new Error('Publish the independent current Result Candidate before freezing');
    if(view.publication.revisionId!==view.task.currentRevisionId)throw new Error('Publication revision stale');
    response={frozenAt:new Date().toISOString(),instance_id:id,independent:true,taskId,revisionId:view.task.currentRevisionId,publication:view.publication,currentRevision:view.currentRevision,analystNote:input,settings:{qualification:'required',fieldProbes:true,externalAdvisor:'not_configured',specFeedback:'not_configured',fanout:'disabled_for_offline_audit',populationDecisions:'allow_disclosed_headless_audit',databaseReadOnly:true}};
    await writeFile(frozenPath,JSON.stringify(response,null,2),{encoding:'utf8',flag:'wx'});
  } else if(op==='reveal') {
    await access(path.join(dir,'independent-freeze.json'));
    const audit=JSON.parse(await readFile(path.join(HERE,'../fieldtree-20261010-audit/registry.json'),'utf8')).find(x=>x.instance_id===id);
    const old=await readFile(audit.sql_file,'utf8');
    const suite='C:/data-agent-eval/Spider2/spider2-lite';
    const settings=(await readFile(path.join(suite,'evaluation_suite/gold/spider2lite_eval.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse).find(x=>x.instance_id===id);
    const {readdir}=await import('node:fs/promises');
    const goldDir=path.join(suite,'evaluation_suite/gold/exec_result');
    const goldFiles=(await readdir(goldDir)).filter(n=>n.startsWith(id)&&n.endsWith('.csv'));
    response={revealedAt:new Date().toISOString(),registry:audit,originalSql:old,originalCsv:await readFile(audit.csv_file,'utf8'),goldSql:audit.gold_sql_file?await readFile(audit.gold_sql_file,'utf8'):null,goldCsv:await Promise.all(goldFiles.map(async n=>({path:path.join(goldDir,n),content:await readFile(path.join(goldDir,n),'utf8')}))),evaluationSettings:settings};
    await writeFile(path.join(dir,'comparison-input.json'),JSON.stringify(response,null,2),'utf8');
  }
  console.log(JSON.stringify(response,null,2));
} catch(e) {console.error(JSON.stringify({error:e.message,code:e.code,details:e.details},null,2));process.exitCode=1;}
