/**
 * Transaction Audit — traces every transaction through position and cash rules.
 * Shows running qty/cost per ticker+account and running cash per account.
 */
(function () {
  'use strict';

  // Classification of each normalized type
  var TYPE_RULES = {
    INITIAL_COST_BASIS: { position: true,  intCash: false, extCash: false, label: 'Sets starting qty+cost' },
    BUY:               { position: true,  intCash: true,  extCash: false, label: 'qty+, cost+, cash out' },
    SELL:              { position: true,  intCash: true,  extCash: false, label: 'qty-, cost- (avg), cash in' },
    REINVEST:          { position: true,  intCash: false, extCash: false, label: 'qty+, cost+ (net zero cash)' },
    EXCHANGE:          { position: true,  intCash: false, extCash: false, label: 'qty change (instrument swap)' },
    SWEEP:             { position: true,  intCash: false, extCash: false, label: 'qty+/- money market' },
    COST_ADJUSTMENT:   { position: true,  intCash: false, extCash: false, label: 'cost adjustment only' },
    DIVIDEND:          { position: false, intCash: true,  extCash: false, label: 'cash in (income)' },
    INTEREST:          { position: false, intCash: true,  extCash: false, label: 'cash in (income)' },
    DISTRIBUTION:      { position: false, intCash: true,  extCash: false, label: 'cash in (fund return)' },
    CAPITAL_CALL:      { position: false, intCash: true,  extCash: false, label: 'cash out (to fund)' },
    FEE:               { position: false, intCash: true,  extCash: false, label: 'cash out (fee)' },
    TRANSFER:          { position: false, intCash: false, extCash: true,  label: 'external cash in/out (check desc for internal)' },
    JOURNAL:           { position: false, intCash: false, extCash: true,  label: 'inter-account (check desc for internal)' },
    ADJUSTMENT:        { position: false, intCash: false, extCash: true,  label: 'misc (check desc for internal)' },
    MEMO:              { position: false, intCash: false, extCash: false, label: 'no-op' },
  };

  // Detect inter-account transfers (not truly external)
  function isInterAccount(desc) {
    var d = (desc || '').toLowerCase();
    return d.indexOf('internal') !== -1 ||
      d.indexOf('from (...') !== -1 || d.indexOf('from (…') !== -1 ||
      d.indexOf('to (...') !== -1 || d.indexOf('to (…') !== -1 ||
      /from \(\.\.\.\d{4}\)/.test(d) || /to \(\.\.\.\d{4}\)/.test(d) ||
      d.indexOf('book transfer') !== -1;
  }

  function initAudit() {
    Utils.showLoading();
    SheetsAPI.readSheet('transactions').then(function (txns) {
      Utils.hideLoading();
      populateFilters(txns);
      document.getElementById('audit-run-btn').addEventListener('click', function () {
        runAudit(txns);
      });
      // Auto-run on load
      runAudit(txns);
    }).catch(function (err) {
      Utils.hideLoading();
      Utils.showMessage('Error: ' + Utils.errMsg(err), 'error');
    });
  }

  function populateFilters(txns) {
    var accounts = {};
    txns.forEach(function (t) {
      var acct = t.account_name || '';
      if (acct) accounts[acct] = true;
    });
    var sel = document.getElementById('audit-account');
    Object.keys(accounts).sort().forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      sel.appendChild(opt);
    });
  }

  function runAudit(allTxns) {
    var filterAcct = document.getElementById('audit-account').value;
    var filterTicker = document.getElementById('audit-ticker').value.trim().toUpperCase();
    var filterDate = document.getElementById('audit-date').value.trim();

    // Filter transactions
    var txns = allTxns.filter(function (t) {
      if (filterAcct !== 'All' && t.account_name !== filterAcct) return false;
      if (filterTicker && (t.ticker || '').toUpperCase().indexOf(filterTicker) === -1) return false;
      if (filterDate && t.date !== filterDate) return false;
      return true;
    });

    // Sort by date, then by processing order
    var typeOrder = { 'INITIAL_COST_BASIS': 0, 'BUY': 1, 'REINVEST': 1, 'DIVIDEND': 2, 'SWEEP': 3 };
    txns.sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      var oa = typeOrder[a.transaction_type] !== undefined ? typeOrder[a.transaction_type] : 5;
      var ob = typeOrder[b.transaction_type] !== undefined ? typeOrder[b.transaction_type] : 5;
      return oa - ob;
    });

    tracePositions(txns);
    traceCash(txns);
    findGaps(txns);
    showSummary(txns);
  }

  // ===== POSITION TRACE =====
  function tracePositions(txns) {
    var container = document.getElementById('audit-positions');
    var thead = document.getElementById('pos-trace-head');
    var tbody = document.getElementById('pos-trace-body');
    container.classList.remove('hidden');

    thead.innerHTML = '<tr>' +
      '<th>Date</th><th>Type</th><th>Ticker</th><th>Account</th>' +
      '<th class="text-right">Txn Qty</th><th class="text-right">Txn Price</th><th class="text-right">Txn Amt</th>' +
      '<th class="text-right">Run Qty</th><th class="text-right">Run Cost</th>' +
      '<th>Rule</th><th>Description</th>' +
      '</tr>';

    // Running state per ticker+account
    var state = {};
    var html = '';

    txns.forEach(function (t) {
      var type = (t.transaction_type || '').toUpperCase();
      var rule = TYPE_RULES[type];
      if (!rule || !rule.position) return; // skip non-position types

      var ticker = (t.ticker || '').toUpperCase();
      var account = t.account_name || '';
      var key = ticker + '|' + account;

      if (!state[key]) state[key] = { qty: 0, cost: 0 };
      var s = state[key];

      var tQty = Utils.parseNumber(t.quantity);
      var tPrice = Utils.parseNumber(t.price);
      var tAmount = Utils.parseNumber(t.amount);
      var desc = t.description || '';

      // Apply position rules (mirrors process-transactions.js)
      var action = '';
      switch (type) {
        case 'INITIAL_COST_BASIS':
          s.qty += tQty;
          s.cost += tAmount;
          action = 'qty += ' + tQty + ', cost += ' + fmtN(tAmount);
          break;
        case 'BUY':
          var buyQty = Math.abs(tQty);
          s.qty += buyQty;
          var buyCost = Math.abs(tAmount) || (buyQty * tPrice);
          s.cost += buyCost;
          action = 'qty += ' + buyQty + ', cost += ' + fmtN(buyCost);
          break;
        case 'REINVEST':
          var riQty = Math.abs(tQty);
          s.qty += riQty;
          var riCost = Math.abs(tAmount) || (riQty * tPrice);
          s.cost += riCost;
          action = 'qty += ' + riQty + ', cost += ' + fmtN(riCost);
          break;
        case 'SELL':
          var sellQty = Math.abs(tQty);
          var avgCost = s.qty > 0 ? s.cost / s.qty : 0;
          var costReduction = sellQty * avgCost;
          s.cost -= costReduction;
          s.qty -= sellQty;
          action = 'qty -= ' + sellQty + ', cost -= ' + fmtN(costReduction) + ' (avg ' + fmtN(avgCost) + ')';
          break;
        case 'COST_ADJUSTMENT':
          s.cost += tAmount;
          action = 'cost += ' + fmtN(tAmount);
          break;
        case 'EXCHANGE':
          if (tQty < 0) {
            var exSellQty = Math.abs(tQty);
            var exAvg = s.qty > 0 ? s.cost / s.qty : 0;
            s.cost -= exSellQty * exAvg;
            s.qty -= exSellQty;
            action = 'qty -= ' + exSellQty + ' (exchange out)';
          } else if (tQty > 0) {
            s.qty += tQty;
            var exCost = Math.abs(tAmount) || (tQty * tPrice);
            s.cost += exCost;
            action = 'qty += ' + tQty + ' (exchange in)';
          }
          break;
        case 'SWEEP':
          if (tQty > 0 || (tQty === 0 && tAmount > 0)) {
            var swBuyQty = tQty || tAmount;
            s.qty += swBuyQty;
            var swCost = Math.abs(tAmount) || (swBuyQty * tPrice);
            s.cost += swCost;
            action = 'qty += ' + fmtN(swBuyQty) + ' (sweep in)';
          } else if (tQty < 0 || tAmount < 0) {
            var swSellQty = Math.abs(tQty) || Math.abs(tAmount);
            var swAvg = s.qty > 0 ? s.cost / s.qty : 0;
            s.cost -= swSellQty * swAvg;
            s.qty -= swSellQty;
            action = 'qty -= ' + fmtN(swSellQty) + ' (sweep out)';
          }
          break;
      }

      html += '<tr>' +
        '<td>' + Utils.esc(t.date) + '</td>' +
        '<td><span class="badge ' + Config.getTypeBadgeClass(type) + '">' + type + '</span></td>' +
        '<td>' + Utils.esc(t.ticker) + '</td>' +
        '<td>' + Utils.esc(account) + '</td>' +
        '<td class="text-right">' + Utils.formatQty(tQty) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(tPrice) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(tAmount) + '</td>' +
        '<td class="text-right font-bold">' + Utils.formatQty(s.qty) + '</td>' +
        '<td class="text-right font-bold">' + Utils.formatCurrency(s.cost) + '</td>' +
        '<td class="text-sm">' + Utils.esc(action) + '</td>' +
        '<td class="text-sm text-muted truncate" style="max-width:200px" title="' + Utils.esc(desc) + '">' + Utils.esc(desc.substring(0, 60)) + '</td>' +
        '</tr>';
    });

    tbody.innerHTML = html || '<tr><td colspan="11" class="text-center text-muted">No position transactions</td></tr>';
  }

  // ===== CASH TRACE =====
  function traceCash(txns) {
    var container = document.getElementById('audit-cash');
    var thead = document.getElementById('cash-trace-head');
    var tbody = document.getElementById('cash-trace-body');
    container.classList.remove('hidden');

    thead.innerHTML = '<tr>' +
      '<th>Date</th><th>Type</th><th>Ticker</th><th>Account</th>' +
      '<th class="text-right">Amount</th>' +
      '<th>Bucket</th>' +
      '<th class="text-right">Run Int Cash</th><th class="text-right">Run Ext Cash</th>' +
      '<th>Description</th>' +
      '</tr>';

    // Running cash per account: internal and external
    var cashState = {};
    var html = '';

    txns.forEach(function (t) {
      var type = (t.transaction_type || '').toUpperCase();
      var account = t.account_name || '';
      var tAmount = Utils.parseNumber(t.amount);
      var tQty = Utils.parseNumber(t.quantity);
      var tPrice = Utils.parseNumber(t.price);
      var desc = (t.description || '').toLowerCase();

      if (!cashState[account]) cashState[account] = { internal: 0, external: 0 };
      var cs = cashState[account];

      var bucket = '';
      var cashDelta = 0;
      var isExternal = false;

      switch (type) {
        case 'DIVIDEND':
        case 'INTEREST':
          cashDelta = tAmount;
          bucket = 'Internal: income';
          break;
        case 'DISTRIBUTION':
          cashDelta = tAmount;
          bucket = 'Internal: distribution';
          break;
        case 'CAPITAL_CALL':
          cashDelta = -Math.abs(tAmount);
          bucket = 'Internal: capital call';
          break;
        case 'FEE':
          cashDelta = -Math.abs(tAmount);
          bucket = 'Internal: fee';
          break;
        case 'BUY':
          cashDelta = -(Math.abs(tAmount) || (Math.abs(tQty) * tPrice));
          bucket = 'Internal: buy';
          break;
        case 'SELL':
          cashDelta = Math.abs(tAmount) || (Math.abs(tQty) * tPrice);
          bucket = 'Internal: sell proceeds';
          break;
        case 'REINVEST':
          // Net zero: dividend cash used to buy shares
          bucket = 'Internal: reinvest (net zero)';
          cashDelta = 0;
          break;
        case 'TRANSFER':
        case 'JOURNAL':
        case 'ADJUSTMENT':
          // Check description for inter-account patterns
          if (isInterAccount(t.description)) {
            bucket = 'Inter-account';
            cashDelta = tAmount;
          } else {
            bucket = 'EXTERNAL';
            cashDelta = tAmount;
            isExternal = true;
          }
          break;
        case 'SWEEP':
          // Sweep moves cash to/from money market — internal, but tracked in positions
          bucket = 'Internal: sweep (tracked in positions)';
          cashDelta = 0;
          break;
        default:
          // MEMO, INITIAL_COST_BASIS, EXCHANGE, COST_ADJUSTMENT — no cash
          return;
      }

      if (isExternal) {
        cs.external += cashDelta;
      } else {
        cs.internal += cashDelta;
      }

      var bucketClass = isExternal ? 'negative' : '';
      if (bucket.indexOf('Inter-account') !== -1) bucketClass = 'text-muted';

      html += '<tr>' +
        '<td>' + Utils.esc(t.date) + '</td>' +
        '<td><span class="badge ' + Config.getTypeBadgeClass(type) + '">' + type + '</span></td>' +
        '<td>' + Utils.esc(t.ticker) + '</td>' +
        '<td>' + Utils.esc(account) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(tAmount) + '</td>' +
        '<td class="text-sm ' + bucketClass + '">' + Utils.esc(bucket) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(cs.internal) + '</td>' +
        '<td class="text-right ' + (cs.external !== 0 ? 'font-bold' : '') + '">' + Utils.formatCurrency(cs.external) + '</td>' +
        '<td class="text-sm text-muted truncate" style="max-width:200px" title="' + Utils.esc(t.description || '') + '">' + Utils.esc((t.description || '').substring(0, 60)) + '</td>' +
        '</tr>';
    });

    tbody.innerHTML = html || '<tr><td colspan="9" class="text-center text-muted">No cash transactions</td></tr>';
  }

  // ===== GAPS =====
  function findGaps(txns) {
    var container = document.getElementById('audit-gaps');
    var content = document.getElementById('audit-gaps-content');

    var gaps = [];
    var unknownTypes = {};

    txns.forEach(function (t) {
      var type = (t.transaction_type || '').toUpperCase();

      // Unknown type
      if (!TYPE_RULES[type]) {
        if (!unknownTypes[type]) unknownTypes[type] = 0;
        unknownTypes[type]++;
      }

      // Dividend without matching reinvest or sweep on same date+account
      if (type === 'DIVIDEND') {
        var hasReinvest = txns.some(function (t2) {
          return t2.date === t.date &&
            t2.account_name === t.account_name &&
            (t2.ticker || '').toUpperCase() === (t.ticker || '').toUpperCase() &&
            (t2.transaction_type === 'REINVEST' || t2.transaction_type === 'SWEEP');
        });
        if (!hasReinvest) {
          gaps.push({
            type: 'Unreinvested dividend',
            date: t.date,
            account: t.account_name,
            ticker: t.ticker,
            amount: Utils.parseNumber(t.amount),
            note: 'No REINVEST or SWEEP for this dividend on same date/account/ticker',
          });
        }
      }

      // Transfer/Journal without "internal" in description — flag for review
      if ((type === 'TRANSFER' || type === 'JOURNAL' || type === 'ADJUSTMENT') && t.description) {
        var descLower = (t.description || '').toLowerCase();
        if (descLower.indexOf('internal') === -1) {
          gaps.push({
            type: 'External cash flow',
            date: t.date,
            account: t.account_name,
            ticker: t.ticker || '—',
            amount: Utils.parseNumber(t.amount),
            note: type + ': ' + (t.description || '').substring(0, 80),
          });
        }
      }
    });

    // Unknown types
    Object.keys(unknownTypes).forEach(function (type) {
      gaps.push({
        type: 'Unknown type',
        date: '—',
        account: '—',
        ticker: '—',
        amount: 0,
        note: '"' + type + '" (' + unknownTypes[type] + ' occurrences) — not in TYPE_RULES',
      });
    });

    if (gaps.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    var html = '<div class="table-wrapper"><table>' +
      '<thead><tr><th>Issue</th><th>Date</th><th>Account</th><th>Ticker</th><th class="text-right">Amount</th><th>Note</th></tr></thead><tbody>';

    gaps.forEach(function (g) {
      var cls = g.type === 'External cash flow' ? '' : (g.type === 'Unknown type' ? 'recon-both-mismatch' : 'recon-qty-mismatch');
      html += '<tr class="' + cls + '">' +
        '<td>' + Utils.esc(g.type) + '</td>' +
        '<td>' + Utils.esc(g.date) + '</td>' +
        '<td>' + Utils.esc(g.account) + '</td>' +
        '<td>' + Utils.esc(g.ticker) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(g.amount) + '</td>' +
        '<td class="text-sm">' + Utils.esc(g.note) + '</td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';
    content.innerHTML = html;
  }

  // ===== SUMMARY =====
  function showSummary(txns) {
    var container = document.getElementById('audit-summary');
    var content = document.getElementById('audit-summary-content');
    container.classList.remove('hidden');

    var typeCounts = {};
    var bucketCounts = { position: 0, intCash: 0, extCash: 0, noop: 0, unknown: 0 };

    txns.forEach(function (t) {
      var type = (t.transaction_type || '').toUpperCase();
      if (!typeCounts[type]) typeCounts[type] = 0;
      typeCounts[type]++;

      var rule = TYPE_RULES[type];
      if (!rule) { bucketCounts.unknown++; return; }
      if (rule.position) bucketCounts.position++;
      if (rule.intCash) bucketCounts.intCash++;
      if (rule.extCash) bucketCounts.extCash++;
      if (!rule.position && !rule.intCash && !rule.extCash) bucketCounts.noop++;
    });

    var html = '<div class="flex gap-2 flex-wrap mb-2">';
    html += '<div><strong>Total:</strong> ' + txns.length + '</div>';
    html += '<div><strong>Position:</strong> ' + bucketCounts.position + '</div>';
    html += '<div><strong>Int Cash:</strong> ' + bucketCounts.intCash + '</div>';
    html += '<div><strong>Ext Cash:</strong> ' + bucketCounts.extCash + '</div>';
    html += '<div><strong>No-op:</strong> ' + bucketCounts.noop + '</div>';
    if (bucketCounts.unknown > 0) html += '<div class="negative"><strong>Unknown:</strong> ' + bucketCounts.unknown + '</div>';
    html += '</div>';

    html += '<div class="table-wrapper"><table class="table-compact"><thead><tr><th>Type</th><th class="text-right">Count</th><th>Bucket</th></tr></thead><tbody>';
    Object.keys(typeCounts).sort().forEach(function (type) {
      var rule = TYPE_RULES[type];
      var bucket = rule ? rule.label : 'UNKNOWN';
      html += '<tr><td><span class="badge ' + Config.getTypeBadgeClass(type) + '">' + type + '</span></td>' +
        '<td class="text-right">' + typeCounts[type] + '</td>' +
        '<td class="text-sm">' + Utils.esc(bucket) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    content.innerHTML = html;
  }

  function fmtN(n) {
    return Utils.formatCurrency(n);
  }

  window.initAudit = initAudit;
})();
