import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildAggregateRequest,decodeAggregateResponse,fetchAggregatePage,mergeAggregateRows,loadAggregateOwners,parseAuthDiscovery,ciState} from '../desktop/plugin.js'
const owners=[{login:'alice',kind:'user'},{login:'team',kind:'org'}]
const options=(over={})=>({owners,kind:'prs',state:'open',filters:{},viewer:'alice',...over})
const node=(repo,n,over={})=>({__typename:'PullRequest',number:n,title:`Row ${n}`,updatedAt:`2026-01-${String(n % 28 + 1).padStart(2,'0')}T00:00:00Z`,state:'OPEN',author:{login:'alice'},repository:{nameWithOwner:repo,isArchived:false,isFork:false},labels:{nodes:[{name:'bug',color:'ff0000'}],pageInfo:{hasNextPage:false}},commits:{nodes:[{commit:{statusCheckRollup:{state:'SUCCESS'}}}]},...over})
const page=(nodes,hasNextPage=false,endCursor=null,count=nodes.length)=>({nodes,issueCount:count,pageInfo:{hasNextPage,endCursor}})

test('server queries carry status, archived, personal and chip filters without a fork qualifier',()=>{
 const req=buildAggregateRequest(options({state:'closed',filters:{assigned:true,authored:true,review:true},query:'label:"help wanted" author:alice fix network'}))
 for(const q of Object.values(req.variables).filter(v=>typeof v==='string')){
  for(const token of ['is:pr','is:closed is:unmerged','archived:false','assignee:alice','author:alice','review-requested:alice','label:"help wanted"','"fix" "network"','sort:updated-desc'])assert.ok(q.includes(token),token)
  assert.ok(!q.includes('fork:'))
 }
 assert.match(req.query,/reviewDecision/);assert.match(req.query,/statusCheckRollup/)
 assert.match(buildAggregateRequest(options({state:'merged'})).variables.q0,/is:merged/)
})
test('scope rejects foreign owner/repo, malformed owners and query syntax escape',()=>{
 for(const over of [{filters:{owner:'outsider'}},{filters:{repo:'outsider/r'}},{owners:[{login:'$(bad)',kind:'org'}]},{query:'hello\\x'},{query:'" OR org:evil'},{query:'author:$(bad)'},{query:'x'.repeat(257)}])assert.throws(()=>buildAggregateRequest(options(over)))
 const req=buildAggregateRequest(options({query:'org:evil OR repo:outside/r ; $(id)'}))
 assert.match(req.variables.q0,/"org:evil" "or" "repo:outside\/r"/)
 assert.ok(req.variables.q0.endsWith('user:alice'))
})
test('owner and repo facets narrow within allowed membership',()=>{
 const a=buildAggregateRequest(options({filters:{owner:'team',repo:'team/r'}}))
 assert.equal(a.owners.length,1);assert.match(a.variables.q0,/repo:team\/r/)
 assert.throws(()=>buildAggregateRequest(options({filters:{owner:'team',repo:'alice/r'}})),/outside/)
})
test('ambiguous numbers require repo; explicit references use direct GraphQL lookup beyond search limits',()=>{
 assert.throws(()=>buildAggregateRequest(options({query:'#42'})),/Numbers need/)
 assert.throws(()=>buildAggregateRequest(options({query:'r#42'})),/Owner/)
 for(const over of [{query:'team/r#42'},{query:'r#42',filters:{owner:'team'}},{query:'#42',filters:{repo:'team/r'}}]){
 const r=buildAggregateRequest(options(over));assert.deepEqual(r.exact,{repo:'team/r',number:42});assert.match(r.query,/issueOrPullRequest\(number:\$number\)/);assert.ok(!r.query.includes('search('))
 }
 assert.throws(()=>buildAggregateRequest(options({query:'team/r#99999999999999999'})),/number/)
})
test('issues cannot use PR-only state/review filters',()=>{
 assert.throws(()=>buildAggregateRequest(options({kind:'issues',state:'merged'})),/only/)
 assert.throws(()=>buildAggregateRequest(options({kind:'issues',filters:{review:true}})),/only/)
 assert.match(buildAggregateRequest(options({kind:'issues'})).variables.q0,/is:issue/)
})
test('row merge disambiguates equal numbers across repos and dedupes case-insensitively by freshest update',()=>{
 const old={repo:'alice/r',number:42,updatedAt:'2025-01-01',title:'old'}
 const fresh={...old,repo:'ALICE/R',updatedAt:'2026-01-01',title:'new'}
 const foreign={repo:'team/r',number:42,updatedAt:'2026-02-01'}
 assert.deepEqual(mergeAggregateRows([old,foreign],[fresh,old]).map(r=>[r.repo,r.title]),[['team/r',undefined],['ALICE/R','new']])
 assert.throws(()=>mergeAggregateRows([],[{repo:'bad',number:1}]),/identity/)
})
test('decoder excludes archived/forks, preserves CI/review/labels/stats and validates owner boundary',()=>{
 const req=buildAggregateRequest(options())
 const a=node('alice/r',1,{reviewDecision:'APPROVED',additions:17,deletions:3,changedFiles:2})
 const data={s0:page([a,node('alice/fork',2,{repository:{nameWithOwner:'alice/fork',isFork:true}}),node('alice/old',3,{repository:{nameWithOwner:'alice/old',isArchived:true}})]),s1:page([node('team/r',1)])}
 const d=decodeAggregateResponse({data},req);assert.equal(d.rows.length,2)
 const row=d.rows.find(r=>r.repo==='alice/r');assert.equal(ciState(row.statusCheckRollup),'passing');assert.equal(row.reviewDecision,'APPROVED');assert.equal(row.additions,17);assert.equal(row.labels[0].name,'bug')
 assert.equal(decodeAggregateResponse({data},buildAggregateRequest(options({filters:{forks:true}}))).rows.length,3)
 assert.throws(()=>decodeAggregateResponse({data:{...data,s0:page([node('outsider/r',1)])}},req),/out-of-scope/)
})
test('partial SSO errors skip only that org even when GraphQL supplies partial nested data',()=>{
 const req=buildAggregateRequest(options())
 for(const s1 of [null,page([null])]){
 const d=decodeAggregateResponse({data:{s0:page([node('alice/r',1)]),s1},errors:[{message:'Resource protected by SAML SSO',path:['s1','nodes',0]}]},req)
 assert.equal(d.rows.length,1);assert.equal(d.cursors.team.skipped,true);assert.match(d.notices[0],/team.*SSO/)
 }
})
test('rate, network, unknown and personal authorization errors never become silent partial success',()=>{
 const req=buildAggregateRequest(options())
 for(const e of [{message:'rate limit exceeded',path:['s1']},{message:'network timeout',path:['s1']},{message:'SAML SSO',path:['s0']},{message:'Unknown',path:['s1']},{message:'SAML',path:[]}])assert.throws(()=>decodeAggregateResponse({data:{},errors:[e]},req))
 assert.throws(()=>decodeAggregateResponse({message:'Bad credentials'},req),/credentials/)
})
test('pagination walks past 30 rows and requests only unfinished owners with actual cursors',async()=>{
 let calls=0
 const run=async req=>{
 calls++
 if(calls===1)return {data:{s0:page(Array.from({length:50},(_,i)=>node('alice/r',i+1)),true,'cursor-a',52),s1:page([node('team/r',1)])}}
 assert.equal(req.owners.length,1);assert.equal(req.variables.c0,'cursor-a')
 return {data:{s0:page([node('alice/r',51),node('alice/r',52)],false,'end',52)}}
 }
 const first=await fetchAggregatePage(options(),undefined,run);assert.equal(first.rows.length,51);assert.equal(first.hasMore,true)
 const next=await fetchAggregatePage(options(),first,run);assert.equal(next.rows.length,53);assert.equal(next.hasMore,false)
 await fetchAggregatePage(options(),next,run);assert.equal(calls,2)
})
test('large organization inventories batch owners, never repositories, without dropping any owner',async()=>{
 const os=Array.from({length:19},(_,i)=>({login:`org${i}`,kind:'org'}));let calls=0
 const out=await fetchAggregatePage(options({owners:os}),undefined,async req=>{calls++;assert.ok(req.owners.length<=8);return {data:Object.fromEntries(req.owners.map((o,i)=>[`s${i}`,page([node(`${o.login}/r`,1)])]))}})
 assert.equal(calls,3);assert.equal(out.rows.length,19)
})
test('1000-search cap, metadata caps and quota are disclosed; broken cursors fail',()=>{
 const req=buildAggregateRequest(options({owners:[owners[0]]}))
 const d=decodeAggregateResponse({data:{s0:page([node('alice/r',1,{labels:{nodes:[],pageInfo:{hasNextPage:true}}})],true,'c',1201),rateLimit:{remaining:80,resetAt:'2026-10-12T15:00:00Z'}}},req)
 assert.match(d.notices.join(' '),/1,000 of 1201/);assert.match(d.notices.join(' '),/label/);assert.match(d.notices.join(' '),/quota low/)
 assert.throws(()=>decodeAggregateResponse({data:{s0:page([],true,null,5)}},req),/continuation/)
 assert.throws(()=>decodeAggregateResponse({data:{s0:page([],true,'c',5)}},req,{rows:[],notices:[],cursors:{alice:{cursor:'c'}}}),/advance/)
})
test('direct exact lookup respects kind/status/fork/archived and personal filters',()=>{
 const req=buildAggregateRequest(options({query:'alice/r#42',filters:{assigned:true,authored:true,review:true}}))
 const good=node('alice/r',42,{assignees:{nodes:[{login:'alice'}]},reviewRequests:{nodes:[{requestedReviewer:{login:'alice'}}]}})
 const run=n=>decodeAggregateResponse({data:{s0:{issueOrPullRequest:n}}},req)
 assert.equal(run(good).rows.length,1)
 for(const over of [{state:'MERGED'},{__typename:'Issue'},{author:{login:'bob'}},{assignees:{nodes:[]}},{reviewRequests:{nodes:[]}},{number:142}])assert.equal(run({...good,...over}).rows.length,0)
 assert.equal(run(null).rows.length,0)
})
test('auth metadata distinguishes missing read:org from unknown fine-grained scope and SSO',()=>{
 const header=scopes=>`HTTP/2.0 200 OK\r\nx-oauth-scopes: ${scopes}\r\n\r\n{"login":"alice"}`
 assert.match(parseAuthDiscovery(header('repo')).notices[0],/lack read:org/)
 assert.equal(parseAuthDiscovery(header('repo, read:org')).notices.length,0)
 assert.match(parseAuthDiscovery(header('')).notices[0],/unavailable/)
 assert.throws(()=>parseAuthDiscovery('invalid'))
})
test('owner discovery paginates and excludes collaborator owners by construction',async()=>{
 let calls=[]
 const out=await loadAggregateOwners(async cmd=>{calls.push(cmd);return calls.length===1?'HTTP/2.0 200\nx-oauth-scopes: read:org\n\n{"login":"alice"}':'[[{"login":"team"}],[{"login":"TEAM"},{"login":"second"}]]'})
 assert.deepEqual(out.owners.map(o=>o.login),['alice','team','second']);assert.match(calls[1],/--paginate --slurp/);assert.ok(!calls.some(c=>c.includes('repos')))
})
test('organization discovery access failure preserves personal scope; other failures are fatal',async()=>{
 for(const message of ['HTTP 403: SAML SSO authorization required','OAuth organization restriction']){
 let calls=0;const out=await loadAggregateOwners(async()=>{if(++calls===1)return 'HTTP/2 200\nx-oauth-scopes: read:org\n\n{"login":"alice"}';throw new Error(message)})
 assert.equal(out.owners.length,1);assert.match(out.notices[0],/personal repositories only/)
 }
 let count=0;await assert.rejects(loadAggregateOwners(async()=>{if(++count===1)return 'HTTP/2 200\n\n{"login":"alice"}';throw new Error('network timeout')}),/network/)
})
test('combined cache and mutation wiring preserve single-repo discovery and exact detail repo',()=>{
 const s=readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8')
 assert.match(s,/queryKey:key,enabled:active[\s\S]*staleTime:60_000,retry:false,refetchOnWindowFocus:false/)
 assert.match(s,/setQueryData\(key,next\)/)
 assert.equal((s.match(/repo:selPr.repo \|\| repo/g)||[]).length,2)
 assert.equal((s.match(/repo:selIssue.repo \|\| repo/g)||[]).length,2)
 assert.match(s,/if \(sessionRepo !== repo && !aggregateScope\(repo\)\)/)
 assert.match(s,/storage.set\('repo', repo\)/)
})
