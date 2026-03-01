#!/usr/bin/env node
/**
 * Reads the 9 position CSVs with 4-digit account numbers,
 * normalizes them, and outputs data for gsheet upload.
 *
 * Run: node load-positions.js
 * Outputs: positions-for-gsheet.csv (assets, marks, transactions)
 */
var fs = require('fs');
var path = require('path');

var ACCOUNT_LAST4 = {
  '3515': 'LFRM Brokerage',
  '8409': 'JJB',
  '8005': 'JJB HF_PE',
  '0166': 'Juju Sec',
  '6008': 'LEONARD FEDER IRA RO',
  '7037': 'LFRM MLP',
  '9762': 'Roth LF',
  '9782': 'Roth RM',
  '1888': 'IRA LF',
};

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
      obj[headers[j].replace(/^"|"$/g, '').trim()] = (vals[j] || '').replace(/^"|"$/g, '').trim();
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
  if (!s) return '2025-01-31';
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return '2025-01-31';
}

// Find the 9 position files
var csvDir = path.join(__dirname, 'CSVs');
var files = fs.readdirSync(csvDir).filter(function (f) {
  return f.match(/^positions \(.+ \d{4}\)\.csv$/);
});

console.log('Found ' + files.length + ' position files:');
files.forEach(function (f) { console.log('  ' + f); });

var allAssets = {};  // ticker -> { ticker, description, asset_class }
var allMarks = [];   // [ticker, date, price]
var allTxns = [];    // [date, type, ticker, account, qty, price, cost]

files.forEach(function (filename) {
  var match = filename.match(/(\d{4})\)/);
  if (!match) return;
  var account = ACCOUNT_LAST4[match[1]] || match[1];

  var text = fs.readFileSync(path.join(csvDir, filename), 'utf8');
  var rows = parseCSV(text);

  console.log('\n' + filename + ': ' + rows.length + ' rows -> account: ' + account);

  rows.forEach(function (r) {
    var ticker = (r['Ticker'] || '').trim();
    var description = (r['Description'] || '').replace(/^\*+/, '').trim();
    var assetClass = (r['Asset Class'] || '').trim();
    var qty = parseNum(r['Quantity']);
    var price = parseNum(r['Price']);
    var value = parseNum(r['Value']);
    var cost = parseNum(r['Cost']);
    var rawDate = r['As of'] || r['Pricing Date'] || '';
    var date = parseDate(rawDate);

    // Skip zero-everything rows
    if (qty === 0 && value === 0 && cost === 0) return;

    // Generate ticker for PE/alternatives with no ticker
    if (!ticker && description) {
      ticker = description.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 15);
    }
    if (!ticker) return;

    // Asset
    var key = ticker.toUpperCase();
    if (!allAssets[key]) {
      allAssets[key] = { ticker: ticker, description: description, asset_class: assetClass };
    }

    // Mark
    allMarks.push([ticker, date, price]);

    // Transaction (INITIAL_COST_BASIS)
    allTxns.push([date, 'INITIAL_COST_BASIS', ticker, account, qty, price, cost]);

    console.log('  ' + ticker + '  qty=' + qty + '  price=' + price + '  cost=$' + cost.toLocaleString());
  });
});

// Write output files
var assetLines = ['ticker\tasset_name\tasset_class'];
Object.values(allAssets).forEach(function (a) {
  assetLines.push(a.ticker + '\t' + a.description + '\t' + a.asset_class);
});

var markLines = ['ticker\tdate\tprice'];
allMarks.forEach(function (m) {
  markLines.push(m.join('\t'));
});

var txnLines = ['date\ttransaction_type\tticker\taccount_name\tquantity\tprice\tamount'];
allTxns.forEach(function (t) {
  txnLines.push(t.join('\t'));
});

fs.writeFileSync(path.join(__dirname, 'output-assets.tsv'), assetLines.join('\n'));
fs.writeFileSync(path.join(__dirname, 'output-marks.tsv'), markLines.join('\n'));
fs.writeFileSync(path.join(__dirname, 'output-transactions.tsv'), txnLines.join('\n'));

console.log('\n=== SUMMARY ===');
console.log('Assets: ' + Object.keys(allAssets).length);
console.log('Marks: ' + allMarks.length);
console.log('Transactions: ' + allTxns.length);
console.log('\nFiles written:');
console.log('  output-assets.tsv');
console.log('  output-marks.tsv');
console.log('  output-transactions.tsv');
console.log('\nCopy-paste these into the corresponding gsheet tabs.');
