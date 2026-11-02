import test from "node:test";
import assert from "node:assert/strict";
import {defaults,balanceMap,summarize,evaluate,loan,deposit,safeState,inRange,categoryTotals} from "../public/js/core.js";

test("default state has accounts and categories",()=>{const s=defaults();assert.equal(s.accounts.length,2);assert.ok(s.categories.length>0)});
test("account balances include income, expense and transfers",()=>{const s=defaults();s.tx=[{type:"income",amount:10000,acc:"cash"},{type:"expense",amount:2500,acc:"cash"},{type:"transfer",amount:3000,acc:"cash",to:"card"}];const b=balanceMap(s);assert.equal(b.cash,4500);assert.equal(b.card,3000)});
test("summary excludes transfers",()=>{assert.deepEqual(summarize([{type:"income",amount:1000},{type:"expense",amount:400},{type:"transfer",amount:500}]),{income:1000,expense:400,net:600})});
test("safe expression evaluator supports arithmetic and percent",()=>{assert.equal(evaluate("(1000+500)*10%"),150);assert.equal(evaluate("2+3*4"),14);assert.throws(()=>evaluate("1/0"))});
test("loan and deposit return positive projections",()=>{assert.ok(loan(100000,12,12).total>100000);assert.ok(deposit(10000,10,12,1000).final>22000)});
test("backup state sanitizer falls back safely",()=>{const s=safeState({tx:[],accounts:[]});assert.equal(s.accounts.length,2);assert.deepEqual(s.tx,[])});
test("date filter and category totals",()=>{const tx=[{date:"2026-01-01",type:"expense",cat:"food",amount:100},{date:"2026-02-01",type:"expense",cat:"food",amount:200}];assert.equal(inRange(tx,"2026-02-01","2026-02-28").length,1);assert.deepEqual(categoryTotals(tx,"expense"),[["food",300]])});
test("восстановление из старой копии добавляет id операциям, целям и регулярным платежам",()=>{const s=safeState({tx:[{type:"expense",amount:1,date:"2026-01-01"}],goals:[{name:"x",target:1,saved:0}],recurring:[{type:"expense",amount:1}]});assert.ok(s.tx[0].id&&s.goals[0].id&&s.recurring[0].id)});
