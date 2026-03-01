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

// Map from JPM description (uppercase, stripped) to correct gsheet ticker
// For positions with no ticker in the CSV, match by description
var DESCRIPTION_TO_TICKER = {
  'SIXTH STREET LENDING PARTNERS - ONSHORE - CLASS A': 'SIXTHST',
  'JUNIUS PARTNER PROGRAM ONSHORE': 'JUNIUSPART',
  'COATUE GROWTH V PRIVATE INVESTORS, L.L.C. - DIK - CLASS A': 'COATUEVA',
  'JUNIUS BEL AIR CIV US ONSHORE, LP': 'JUNIUSBELA',
  'TIGER GLOBAL PIP XV PRIVATE INVESTORS, LLC  - DIK - CLASS A': 'TIGER',
  'CSSAF PRIVATE INVESTORS, LLC (CARLYLE SUB-SAHARAN AFRICA FUND) CLASS A': 'CSSAF',
  'COATUE GROWTH FUND V-B PRIVATE INVESTORS, LLC DIK - CLASS A': 'COATUEVB',
  'GSO PRIVATE INVESTORS II, LLC CLASS A': 'GSO',
  'JPMORGAN DEPOSIT ACCT D BROKERAGE RET JPMC BK NA': 'JPMACCTD',
  'JPMORGAN DEPOSIT ACCT A ADVISORY NON RET JPMC BK NA': 'JPMACCTA',
  'UNITED STATES DOLLAR CURRENCY CONTRACT': 'USD',
  'US DOLLAR': 'USDOLLAR',
  'ENLINK MIDSTREAM LLC COM UNIT REPSTG LTD LIABILITY CO INTS': 'ENLINK',
  'WTS FATHOM DIGITAL MANUFACTURING CORPORATION ECH WT EXRBL FR CL A SHR FR $11.50': 'FATHOM',
  'ACCOUNT CONTROL AGREEMENT': null,  // skip - not a real holding
  'JPMORGAN CHASE BANK LOAN': null,   // skip - not a real holding
  'CLIENT HAS JPMS OMNI ACCOUNT': null, // skip - not a real holding
};

var ACCOUNT_LAST4 = {
  '3515': 'LFRM-JPM-3515',
  '8409': 'JJB-JPM-8409',
  '8005': 'JJB-JPM-8005',
  '0166': 'Juju-JPM-0166',
  '6008': 'LFRM-JPM-IRA-6008',
  '7037': 'LFRM-JPM-MLP-7037',
  '9762': 'LFRM-JPM-Roth-9762',
  '9782': 'LFRM-JPM-Roth-9782',
  '1888': 'LFRM-JPM-IRA-1888',
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

    // Check description mapping for ticker override or skip
    if (DESCRIPTION_TO_TICKER.hasOwnProperty(description)) {
      var mapped = DESCRIPTION_TO_TICKER[description];
      if (mapped === null) return; // skip non-holdings
      if (mapped) ticker = mapped;
    }

    // For positions with no ticker and no description mapping, generate one
    if (!ticker && description) {
      ticker = description.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 15);
      console.log('  WARNING: no ticker mapping for "' + description + '" -> generated ' + ticker);
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

// Write output files as CSV
function csvEscape(val) {
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCSVLine(arr) {
  return arr.map(csvEscape).join(',');
}

var assetLines = [toCSVLine(['ticker', 'asset_name', 'asset_class'])];
Object.values(allAssets).forEach(function (a) {
  assetLines.push(toCSVLine([a.ticker, a.description, a.asset_class]));
});

var markLines = [toCSVLine(['ticker', 'date', 'price'])];
allMarks.forEach(function (m) {
  markLines.push(toCSVLine(m));
});

var txnLines = [toCSVLine(['date', 'transaction_type', 'ticker', 'account_name', 'quantity', 'price', 'amount'])];
allTxns.forEach(function (t) {
  txnLines.push(toCSVLine(t));
});

fs.writeFileSync(path.join(__dirname, 'upload-assets.csv'), assetLines.join('\n'));
fs.writeFileSync(path.join(__dirname, 'upload-marks.csv'), markLines.join('\n'));
fs.writeFileSync(path.join(__dirname, 'upload-transactions.csv'), txnLines.join('\n'));

console.log('\n=== SUMMARY ===');
console.log('Assets: ' + Object.keys(allAssets).length);
console.log('Marks: ' + allMarks.length);
console.log('Transactions: ' + allTxns.length);
console.log('\nFiles written:');
console.log('  upload-assets.csv');
console.log('  upload-marks.csv');
console.log('  upload-transactions.csv');
console.log('\nCopy-paste these into the corresponding gsheet tabs.');
