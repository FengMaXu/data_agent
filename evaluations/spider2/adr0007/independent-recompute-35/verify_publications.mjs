// Integrity check only: no database access, SQL execution or model calls.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileResultStore} from '../../../../packages/runtime/dist/answering/result-store.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const ids=(await readFile(path.join(here,'case-ids.txt'),'utf8')).trim().split(/\s+/);
const checks=[];
for(const id of ids){
 const dir=path.join(here,'cases',id);
 const rs=new FileResultStore(path.join(dir,'private-results'));
 for(const name of await readdir(path.join(dir,'publications'))){
  const pubdir=path.join(dir,'publications',name);
  const receipt=JSON.parse(await readFile(path.join(pubdir,'receipt.json'),'utf8'));
  const context={principal:{id:'independent-analyst'},sessionId:id,lane:'main',operationId:'publication-integrity-review',invocationId:'verify-'+name};
  const result=await rs.openAuthorized(receipt.resultRef,receipt,context);
  const csv=await rs.encodeCsv(receipt.resultRef,context);
  const saved=await readFile(path.join(pubdir,'result.csv'),'utf8');
  if(csv.content!==saved)throw new Error(id+' saved CSV differs from authorized result bytes');
  if(csv.contentHash!==receipt.presentationContentHash)throw new Error(id+' CSV presentation hash differs from Receipt');
  checks.push({instance_id:id,receipt_id:receipt.receiptId,candidate_id:receipt.candidateId,rows:result.rowCount,content_hash_matches:true,presentation_hash_matches:true,authorized_csv_bytes_match:true});
 }
}
await writeFile(path.join(here,'publication-integrity-validation.json'),JSON.stringify({database_queries_executed:0,cases:ids.length,publications_verified:checks.length,checks},null,2),'utf8');
console.log(JSON.stringify({cases:ids.length,publications_verified:checks.length,all_authorized_csv_bytes_match:true}));
