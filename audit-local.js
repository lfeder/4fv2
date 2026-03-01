#!/usr/bin/env node
/**
 * Local Transaction Audit — reads CSVs/transactions.csv, traces every
 * transaction through position + cash rules, identifies gaps.
 *
 * Run: node audit-local.js
 * Options:
 *   node audit-local.js --ticker SPY
 *   node audit-local.js --account "LFRM Brokerage"
 *   node audit-local.js --date 2025-03-03
 *   node audit-local.js --summary
 */
var fs = require('fs');
var path = require('path');

// ===== CONFIG =====
var TYPE_MAP = {
  'BUY': 'BUY', 'Buy': 'BUY', 'SELL': 'SELL', 'Sell': 'SELL',
  'Reinvestment': 'REINVEST', 'REINVEST': 'REINVEST',
  'Dividend': 'DIVIDEND', 'DIVIDEND': 'DIVIDEND',
  'Interest': 'INTEREST', 'INTEREST': 'INTEREST',
  'Funds Wired': 'TRANSFER', 'Funds Received': 'TRANSFER',
  'Transfers': 'TRANSFER', 'TRANSFER': 'TRANSFER',
  'Banklink Manual Pull': 'TRANSFER', 'Banklink Manual Push': 'TRANSFER',
  'Capital Call': 'CAPITAL_CALL', 'CAPITAL_CALL': 'CAPITAL_CALL',
  'Cash Distribution': 'DISTRIBUTION', 'DISTRIBUTION': 'DISTRIBUTION',
  'Cash in lieu': 'DISTRIBUTION',
  'Deposit Sweep - Deposit Intraday Activity': 'SWEEP',
  'Deposit Sweep - Withdrawal Intraday Activity': 'SWEEP', 'SWEEP': 'SWEEP',
  'Misc Debit / Credit': 'ADJUSTMENT', 'Journal': 'JOURNAL',
  'Misc. Disbursement': 'ADJUSTMENT', 'ADJUSTMENT': 'ADJUSTMENT',
  'Cost Adjustment': 'COST_ADJUSTMENT', 'COST_ADJUSTMENT': 'COST_ADJUSTMENT',
  'Exchange': 'EXCHANGE', 'EXCHANGE': 'EXCHANGE',
  'Fees': 'FEE', 'FEE': 'FEE',
  'MEMO ENTRY': 'MEMO', 'MEMO': 'MEMO', 'JOURNAL': 'JOURNAL',
};

// ===== CSV PARSER =====
function parseCSV(text) {
  var lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  var headers = splitLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var vals = splitLine(line);
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j].trim().replace(/^"|"$/g, '')] = (vals[j] || '').replace(/^"|"$/g, '').trim();
    }
    rows.push(obj);
  }
  return rows;
}

function splitLine(line) {
  var result = [], current = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQ) {
      if (ch === '"') { if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; } else { inQ = false; } }
      else { current += ch; }
    } else {
      if (ch === '"') { inQ = true; } else if (ch === ',') { result.push(current); current = ''; } else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function parseNum(s) {
  if (!s) return 0;
  var str = String(s).replace(/[$%,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  var n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function parseDate(s) {
  if (!s) return '';
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return s;
}

function fmtC(n) {
  if (n === 0) return '$0';
  var sign = n < 0 ? '-$' : '$';
  return sign + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQ(n) {
  if (n === 0) return '0';
  if (Math.abs(n) >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toFixed(6);
}

// ===== NORMALIZE =====
function normalizeTxn(raw) {
  var rawType = raw['Type'] || '';
  return {
    date: parseDate(raw['Trade Date'] || ''),
    type: TYPE_MAP[rawType] || rawType.toUpperCase(),
    rawType: rawType,
    ticker: (raw['Ticker'] || '').trim(),
    account: (raw['Account Name'] || '').trim(),
    qty: parseNum(raw['Quantity']),
    price: parseNum(raw['Price USD']),
    amount: parseNum(raw['Amount USD']),
    description: (raw['Description'] || '').trim(),
  };
}

// ===== LOAD & FILTER =====
var csvPath = path.join(__dirname, 'CSVs', 'transactions.csv');
var text = fs.readFileSync(csvPath, 'utf8');
var rawRows = parseCSV(text);
var txns = rawRows.map(normalizeTxn).filter(function (t) { return t.date; });

// Parse CLI args
var args = process.argv.slice(2);
var filterTicker = '', filterAccount = '', filterDate = '', summaryOnly = false;
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--ticker' && args[i + 1]) { filterTicker = args[++i].toUpperCase(); }
  else if (args[i] === '--account' && args[i + 1]) { filterAccount = args[++i]; }
  else if (args[i] === '--date' && args[i + 1]) { filterDate = args[++i]; }
  else if (args[i] === '--summary') { summaryOnly = true; }
}

if (filterTicker) txns = txns.filter(function (t) { return t.ticker.toUpperCase().indexOf(filterTicker) !== -1; });
if (filterAccount) txns = txns.filter(function (t) { return t.account.indexOf(filterAccount) !== -1; });
if (filterDate) txns = txns.filter(function (t) { return t.date === filterDate; });

// Sort
var typeOrder = { 'INITIAL_COST_BASIS': 0, 'DIVIDEND': 1, 'INTEREST': 1, 'BUY': 2, 'REINVEST': 2, 'SWEEP': 3 };
txns.sort(function (a, b) {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  var oa = typeOrder[a.type] !== undefined ? typeOrder[a.type] : 5;
  var ob = typeOrder[b.type] !== undefined ? typeOrder[b.type] : 5;
  return oa - ob;
});

console.log('Total transactions: ' + txns.length);
console.log('');

// ===== SUMMARY =====
var typeCounts = {};
txns.forEach(function (t) {
  if (!typeCounts[t.type]) typeCounts[t.type] = { count: 0, totalAmt: 0 };
  typeCounts[t.type].count++;
  typeCounts[t.type].totalAmt += t.amount;
});

console.log('=== TYPE SUMMARY ===');
console.log(pad('Type', 20) + pad('Count', 8) + pad('Total Amount', 16));
console.log('-'.repeat(44));
Object.keys(typeCounts).sort().forEach(function (type) {
  var c = typeCounts[type];
  console.log(pad(type, 20) + pad(String(c.count), 8) + pad(fmtC(c.totalAmt), 16));
});
console.log('');

if (summaryOnly) process.exit(0);

// ===== POSITION TRACE =====
console.log('=== POSITION TRACE ===');
console.log(pad('Date', 12) + pad('Type', 18) + pad('Ticker', 12) + pad('Account', 25) +
  rpad('TxnQty', 10) + rpad('TxnAmt', 14) + rpad('RunQty', 12) + rpad('RunCost', 14) + '  Action');
console.log('-'.repeat(130));

var posState = {};
txns.forEach(function (t) {
  var posTypes = ['INITIAL_COST_BASIS', 'BUY', 'SELL', 'REINVEST', 'EXCHANGE', 'SWEEP', 'COST_ADJUSTMENT'];
  if (posTypes.indexOf(t.type) === -1) return;

  var key = t.ticker.toUpperCase() + '|' + t.account;
  if (!posState[key]) posState[key] = { qty: 0, cost: 0 };
  var s = posState[key];
  var action = '';

  switch (t.type) {
    case 'INITIAL_COST_BASIS':
      s.qty += t.qty; s.cost += t.amount;
      action = 'qty+=' + fmtQ(t.qty) + ' cost+=' + fmtC(t.amount);
      break;
    case 'BUY':
      var bq = Math.abs(t.qty); var bc = Math.abs(t.amount) || (bq * t.price);
      s.qty += bq; s.cost += bc;
      action = 'qty+=' + fmtQ(bq) + ' cost+=' + fmtC(bc);
      break;
    case 'REINVEST':
      var rq = Math.abs(t.qty); var rc = Math.abs(t.amount) || (rq * t.price);
      s.qty += rq; s.cost += rc;
      action = 'qty+=' + fmtQ(rq) + ' cost+=' + fmtC(rc);
      break;
    case 'SELL':
      var sq = Math.abs(t.qty); var avg = s.qty > 0 ? s.cost / s.qty : 0;
      var cr = sq * avg; s.cost -= cr; s.qty -= sq;
      action = 'qty-=' + fmtQ(sq) + ' cost-=' + fmtC(cr) + ' (avg=' + fmtC(avg) + ')';
      break;
    case 'COST_ADJUSTMENT':
      s.cost += t.amount;
      action = 'cost+=' + fmtC(t.amount);
      break;
    case 'EXCHANGE':
      if (t.qty < 0) {
        var eq = Math.abs(t.qty); var ea = s.qty > 0 ? s.cost / s.qty : 0;
        s.cost -= eq * ea; s.qty -= eq;
        action = 'EXCH OUT qty-=' + fmtQ(eq);
      } else if (t.qty > 0) {
        var ec = Math.abs(t.amount) || (t.qty * t.price);
        s.qty += t.qty; s.cost += ec;
        action = 'EXCH IN qty+=' + fmtQ(t.qty);
      }
      break;
    case 'SWEEP':
      if (t.qty > 0 || (t.qty === 0 && t.amount > 0)) {
        var swq = t.qty || t.amount; var swc = Math.abs(t.amount) || (swq * t.price);
        s.qty += swq; s.cost += swc;
        action = 'SWEEP IN qty+=' + fmtQ(swq);
      } else if (t.qty < 0 || t.amount < 0) {
        var swsq = Math.abs(t.qty) || Math.abs(t.amount);
        var swa = s.qty > 0 ? s.cost / s.qty : 0;
        s.cost -= swsq * swa; s.qty -= swsq;
        action = 'SWEEP OUT qty-=' + fmtQ(swsq);
      }
      break;
  }

  console.log(pad(t.date, 12) + pad(t.type, 18) + pad(t.ticker, 12) + pad(t.account.substring(0, 22), 25) +
    rpad(fmtQ(t.qty), 10) + rpad(fmtC(t.amount), 14) + rpad(fmtQ(s.qty), 12) + rpad(fmtC(s.cost), 14) + '  ' + action);
});

console.log('');
console.log('=== FINAL POSITIONS ===');
console.log(pad('Ticker', 12) + pad('Account', 25) + rpad('Qty', 14) + rpad('Cost', 14));
console.log('-'.repeat(65));
Object.keys(posState).sort().forEach(function (key) {
  var s = posState[key];
  if (s.qty === 0 && s.cost === 0) return;
  var parts = key.split('|');
  console.log(pad(parts[0], 12) + pad(parts[1].substring(0, 22), 25) + rpad(fmtQ(s.qty), 14) + rpad(fmtC(s.cost), 14));
});

// ===== CASH TRACE =====
console.log('');
console.log('=== CASH TRACE ===');
console.log(pad('Date', 12) + pad('Type', 18) + pad('Ticker', 12) + pad('Account', 25) +
  rpad('Amount', 14) + pad('Bucket', 30) + rpad('IntCash', 14) + rpad('ExtCash', 14));
console.log('-'.repeat(140));

var cashState = {};
txns.forEach(function (t) {
  var acct = t.account;
  if (!cashState[acct]) cashState[acct] = { internal: 0, external: 0 };
  var cs = cashState[acct];
  var desc = (t.description || '').toLowerCase();
  var bucket = '', delta = 0, isExt = false;

  switch (t.type) {
    case 'DIVIDEND': case 'INTEREST':
      delta = t.amount; bucket = 'Internal: income'; break;
    case 'DISTRIBUTION':
      delta = t.amount; bucket = 'Internal: distribution'; break;
    case 'CAPITAL_CALL':
      delta = -Math.abs(t.amount); bucket = 'Internal: capital call'; break;
    case 'FEE':
      delta = -Math.abs(t.amount); bucket = 'Internal: fee'; break;
    case 'BUY':
      delta = -(Math.abs(t.amount) || (Math.abs(t.qty) * t.price)); bucket = 'Internal: buy'; break;
    case 'SELL':
      delta = Math.abs(t.amount) || (Math.abs(t.qty) * t.price); bucket = 'Internal: sell'; break;
    case 'REINVEST':
      delta = 0; bucket = 'Internal: reinvest (net 0)'; break;
    case 'TRANSFER': case 'JOURNAL': case 'ADJUSTMENT':
      if (isInterAccount(t.description)) {
        delta = t.amount; bucket = 'Inter-account';
      } else {
        delta = t.amount; bucket = '*** EXTERNAL ***'; isExt = true;
      }
      break;
    case 'SWEEP':
      delta = 0; bucket = 'Internal: sweep (in positions)'; break;
    default: return;
  }

  if (isExt) { cs.external += delta; } else { cs.internal += delta; }

  console.log(pad(t.date, 12) + pad(t.type, 18) + pad(t.ticker.substring(0, 10), 12) + pad(acct.substring(0, 22), 25) +
    rpad(fmtC(t.amount), 14) + pad(bucket, 30) + rpad(fmtC(cs.internal), 14) + rpad(fmtC(cs.external), 14));
});

console.log('');
console.log('=== CASH BALANCES (per account) ===');
console.log(pad('Account', 30) + rpad('Internal Cash', 16) + rpad('External Cash', 16));
console.log('-'.repeat(62));
Object.keys(cashState).sort().forEach(function (acct) {
  var cs = cashState[acct];
  console.log(pad(acct.substring(0, 28), 30) + rpad(fmtC(cs.internal), 16) + rpad(fmtC(cs.external), 16));
});

// ===== INTER-ACCOUNT DETECTION =====
function isInterAccount(desc) {
  var d = (desc || '').toLowerCase();
  return d.indexOf('internal') !== -1 ||
    d.indexOf('from (...') !== -1 || d.indexOf('from (…') !== -1 ||
    d.indexOf('to (...') !== -1 || d.indexOf('to (…') !== -1 ||
    /from \(\.\.\.\d{4}\)/.test(d) || /to \(\.\.\.\d{4}\)/.test(d) ||
    d.indexOf('book transfer') !== -1;
}

// ===== GAPS =====
console.log('');
console.log('=== GAPS & FLAGS ===');

var gapCount = 0;

// Unreinvested dividends
txns.forEach(function (t) {
  if (t.type !== 'DIVIDEND') return;
  var hasMatch = txns.some(function (t2) {
    return t2.date === t.date && t2.account === t.account &&
      t2.ticker.toUpperCase() === t.ticker.toUpperCase() &&
      (t2.type === 'REINVEST' || t2.type === 'SWEEP');
  });
  if (!hasMatch) {
    console.log('UNREINVESTED DIV: ' + t.date + ' ' + t.account + ' ' + t.ticker + ' ' + fmtC(t.amount) +
      '  desc: ' + t.description.substring(0, 60));
    gapCount++;
  }
});

// Unknown types
var unknowns = {};
txns.forEach(function (t) {
  var known = ['INITIAL_COST_BASIS', 'BUY', 'SELL', 'REINVEST', 'EXCHANGE', 'SWEEP',
    'COST_ADJUSTMENT', 'DIVIDEND', 'INTEREST', 'DISTRIBUTION', 'CAPITAL_CALL',
    'FEE', 'TRANSFER', 'JOURNAL', 'ADJUSTMENT', 'MEMO'];
  if (known.indexOf(t.type) === -1) {
    if (!unknowns[t.type]) unknowns[t.type] = 0;
    unknowns[t.type]++;
  }
});
Object.keys(unknowns).forEach(function (t) {
  console.log('UNKNOWN TYPE: "' + t + '" (' + unknowns[t] + ' occurrences)');
  gapCount++;
});

// External flows — distinguish inter-account from true external
txns.forEach(function (t) {
  if ((t.type === 'TRANSFER' || t.type === 'JOURNAL' || t.type === 'ADJUSTMENT')) {
    var interAcct = isInterAccount(t.description);
    var label = interAcct ? 'INTER-ACCOUNT' : 'EXTERNAL';
    console.log(label + ': ' + t.date + ' ' + pad(t.type, 12) + ' ' + pad(t.account.substring(0, 20), 22) +
      ' ' + rpad(fmtC(t.amount), 14) + '  ' + t.description.substring(0, 70));
    gapCount++;
  }
});

if (gapCount === 0) console.log('No gaps found!');
console.log('\nTotal flags: ' + gapCount);

// ===== HELPERS =====
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function rpad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
