#!/usr/bin/env node
/**
 * 對正式 Supabase 執行一個 .sql 檔（Management API）。
 *
 * 這個檔案存在的理由是「可稽核」：改資料的 SQL 不該每次都用一串臨時拼出來的
 * curl 帶著 token 送出去 —— 那種指令沒人看得懂、也無從審查。這裡只有一個入口，
 * 執行前必定把完整 SQL 印出來，token 只從 ~/.config/gbm/supabase.env 讀取，
 * 永遠不會被印出或寫進任何檔案。
 *
 *   node scripts/run-sql.mjs <file.sql> [--ref <project-ref>]
 *
 * 唯讀查詢也可以走這裡；寫入請先確認印出來的 SQL 就是你要的。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_REF = 'aiuajbflpwdzkaeeocab';
const TOKEN_FILE = join(homedir(), '.config', 'gbm', 'supabase.env');

function fail(message) {
  process.stderr.write(`run-sql: ${message}\n`);
  process.exit(1);
}

function readToken() {
  let contents;
  try {
    contents = readFileSync(TOKEN_FILE, 'utf8');
  } catch {
    fail(`找不到 ${TOKEN_FILE}`);
  }
  const match = contents.match(/^\s*(?:export\s+)?SUPABASE_ACCESS_TOKEN=["']?([^"'\s]+)/m);
  if (!match) fail(`${TOKEN_FILE} 裡沒有 SUPABASE_ACCESS_TOKEN`);
  return match[1];
}

const args = process.argv.slice(2);
const refFlag = args.indexOf('--ref');
const ref = refFlag === -1 ? DEFAULT_REF : args[refFlag + 1];
// 沒有 --ref 時 refFlag 是 -1，refFlag + 1 會剛好指向第一個引數，
// 也就是檔案本身 —— 所以只有在旗標真的存在時才排除它的值。
const refValueIndex = refFlag === -1 ? -1 : refFlag + 1;
const files = args.filter((arg, index) => !arg.startsWith('--') && index !== refValueIndex);
if (files.length !== 1) fail('用法：node scripts/run-sql.mjs <file.sql> [--ref <project-ref>]');
if (!ref) fail('--ref 後面要接 project ref');

let sql;
try {
  sql = readFileSync(files[0], 'utf8');
} catch (error) {
  fail(`讀不到 ${files[0]}：${error.message}`);
}
if (!sql.trim()) fail(`${files[0]} 是空的`);

// 執行前先攤開來看。被擋下來的每一次都是因為指令本身讀不出意圖。
process.stdout.write(`── 專案 ${ref}，即將執行 ${files[0]} ──\n${sql}\n──\n`);

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${readToken()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
});

const body = await response.text();
process.stdout.write(`HTTP ${response.status}\n`);
try {
  process.stdout.write(`${JSON.stringify(JSON.parse(body), null, 2)}\n`);
} catch {
  process.stdout.write(`${body}\n`);
}
if (!response.ok) process.exit(1);
