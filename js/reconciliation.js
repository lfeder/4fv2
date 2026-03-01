/**
 * Reconciliation — Compare derived positions vs CSV snapshot.
 * Upload a month-end position CSV, compare qty/cost, flag mismatches.
 */
(function () {
  'use strict';

  function initReconciliation() {
    var fileInput = document.getElementById('recon-file');
    var compareBtn = document.getElementById('recon-compare-btn');

    fileInput.addEventListener('change', function () {
      compareBtn.disabled = !fileInput.files.length;
    });

    compareBtn.addEventListener('click', function () {
      var file = fileInput.files[0];
      if (!file) return;

      Utils.showLoading();
      setStatus('Parsing CSV and loading derived positions...', 'info');

      var readFile = new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (e) { resolve(e.target.result); };
        reader.onerror = function () { reject(new Error('Failed to read file')); };
        reader.readAsText(file);
      });

      var account = CSVParser.extractAccountFromFilename(file.name);

      Promise.all([
        readFile,
        SheetsAPI.readSheet('transactions'),
        SheetsAPI.readSheet('marks'),
      ]).then(function (results) {
        var csvText = results[0];
        var transactions = results[1];
        var marks = results[2];

        var parsed = CSVParser.parseCSV(csvText);
        var csvRows = parsed.rows.map(CSVParser.normalizePositionRow);

        // Derive current positions
        var derivedPositions = PositionEngine.derivePositionsFromData(transactions, marks);

        // Build derived lookup: ticker|account -> { qty, cost }
        var derivedMap = {};
        derivedPositions.forEach(function (p) {
          var key = (p.ticker || '') + '|' + (p.account_name || '');
          derivedMap[key] = p;
        });

        // Build CSV lookup
        var csvMap = {};
        csvRows.forEach(function (r) {
          if (!r.ticker) return;
          var acct = account || 'Unknown';
          var key = r.ticker + '|' + acct;
          csvMap[key] = { ticker: r.ticker, account: acct, qty: r.quantity, cost: r.cost, price: r.price, date: r.date };
        });

        // Extract marks from CSV
        var newMarks = [];
        csvRows.forEach(function (r) {
          if (r.ticker && r.price && r.date) {
            newMarks.push([r.ticker, r.date, r.price]);
          }
        });

        // Upsert marks
        var markPromise = newMarks.length > 0
          ? SheetsAPI.upsertRows('marks', newMarks, 0, 1)
          : Promise.resolve({ added: 0, skipped: 0 });

        return markPromise.then(function (markResult) {
          // Compare
          var allKeys = {};
          Object.keys(csvMap).forEach(function (k) { allKeys[k] = true; });
          Object.keys(derivedMap).forEach(function (k) {
            // Only include derived positions for the same account
            if (account && k.indexOf('|' + account) !== -1) {
              allKeys[k] = true;
            }
          });

          var comparisons = [];
          Object.keys(allKeys).sort().forEach(function (key) {
            var csv = csvMap[key];
            var derived = derivedMap[key];

            var comp = {
              ticker: (csv ? csv.ticker : derived.ticker),
              account: (csv ? csv.account : derived.account_name),
              csvQty: csv ? csv.qty : 0,
              derivedQty: derived ? derived.qty : 0,
              csvCost: csv ? csv.cost : 0,
              derivedCost: derived ? derived.cost : 0,
            };

            comp.qtyDiff = comp.csvQty - comp.derivedQty;
            comp.costDiff = comp.csvCost - comp.derivedCost;

            var qtyMatch = Math.abs(comp.qtyDiff) < 0.01;
            var costMatch = Math.abs(comp.costDiff) < 1;

            if (!csv) {
              comp.status = 'CLOSED_POSITION';
            } else if (!derived) {
              comp.status = 'NEW_POSITION';
            } else if (qtyMatch && costMatch) {
              comp.status = 'MATCH';
            } else if (!qtyMatch && !costMatch) {
              comp.status = 'BOTH_MISMATCH';
            } else if (!qtyMatch) {
              comp.status = 'QTY_MISMATCH';
            } else {
              comp.status = 'COST_MISMATCH';
            }

            comparisons.push(comp);
          });

          Utils.hideLoading();
          renderComparison(comparisons, markResult);
        });
      }).catch(function (err) {
        Utils.hideLoading();
        setStatus('Error: ' + err.message, 'error');
      });
    });
  }

  function renderComparison(comparisons, markResult) {
    var counts = { MATCH: 0, QTY_MISMATCH: 0, COST_MISMATCH: 0, BOTH_MISMATCH: 0, NEW_POSITION: 0, CLOSED_POSITION: 0 };
    comparisons.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });

    document.getElementById('recon-metrics').classList.remove('hidden');
    document.getElementById('recon-match-count').textContent = counts.MATCH;
    document.getElementById('recon-mismatch-count').textContent = counts.QTY_MISMATCH + counts.COST_MISMATCH + counts.BOTH_MISMATCH;
    document.getElementById('recon-new-count').textContent = counts.NEW_POSITION;
    document.getElementById('recon-closed-count').textContent = counts.CLOSED_POSITION;

    var marksMsg = markResult ? ' | Marks: ' + markResult.added + ' new, ' + markResult.skipped + ' existing' : '';
    setStatus('Comparison complete. ' + comparisons.length + ' positions checked.' + marksMsg, 'success');

    var tableArea = document.getElementById('recon-table-area');
    var tbody = document.getElementById('recon-body');
    tableArea.classList.remove('hidden');

    var statusLabels = {
      MATCH: 'match', QTY_MISMATCH: 'qty-mismatch', COST_MISMATCH: 'cost-mismatch',
      BOTH_MISMATCH: 'both-mismatch', NEW_POSITION: 'new-position', CLOSED_POSITION: 'closed-position',
    };

    tbody.innerHTML = comparisons.map(function (c) {
      var statusCls = statusLabels[c.status] || '';
      var qtyDiffCls = Math.abs(c.qtyDiff) > 0.01 ? 'negative' : '';
      var costDiffCls = Math.abs(c.costDiff) > 1 ? 'negative' : '';

      return '<tr>' +
        '<td>' + Utils.esc(c.ticker) + '</td>' +
        '<td>' + Utils.esc(c.account) + '</td>' +
        '<td><span class="recon-status ' + statusCls + '">' + c.status.replace(/_/g, ' ') + '</span></td>' +
        '<td class="text-right">' + Utils.formatQty(c.csvQty) + '</td>' +
        '<td class="text-right">' + Utils.formatQty(c.derivedQty) + '</td>' +
        '<td class="text-right ' + qtyDiffCls + '">' + Utils.formatQty(c.qtyDiff) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(c.csvCost) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(c.derivedCost) + '</td>' +
        '<td class="text-right ' + costDiffCls + '">' + Utils.formatCurrency(c.costDiff) + '</td>' +
        '<td>' + getActionButtons(c) + '</td>' +
        '</tr>';
    }).join('');

    // Wire up action buttons
    tbody.querySelectorAll('.accept-csv-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        acceptCSV(btn.dataset.ticker, btn.dataset.account,
          parseFloat(btn.dataset.qtyDiff), parseFloat(btn.dataset.costDiff));
      });
    });
  }

  function getActionButtons(c) {
    if (c.status === 'MATCH' || c.status === 'CLOSED_POSITION') return '';

    return '<button class="btn btn-sm btn-success accept-csv-btn" ' +
      'data-ticker="' + Utils.esc(c.ticker) + '" ' +
      'data-account="' + Utils.esc(c.account) + '" ' +
      'data-qty-diff="' + c.qtyDiff + '" ' +
      'data-cost-diff="' + c.costDiff + '">Accept CSV</button>';
  }

  function acceptCSV(ticker, account, qtyDiff, costDiff) {
    var today = Utils.formatDate(new Date());
    var txns = [];

    if (Math.abs(qtyDiff) > 0.01) {
      // Insert adjustment transaction for qty difference
      var type = qtyDiff > 0 ? 'BUY' : 'SELL';
      txns.push([today, type, ticker, account, Math.abs(qtyDiff), 0, 0]);
    }

    if (Math.abs(costDiff) > 1) {
      txns.push([today, 'COST_ADJUSTMENT', ticker, account, 0, 0, costDiff]);
    }

    if (txns.length === 0) return;

    Utils.showLoading();
    SheetsAPI.appendRows('transactions', txns)
      .then(function () {
        return PositionEngine.recalculatePositions();
      })
      .then(function () {
        Utils.hideLoading();
        Utils.showMessage('Correcting transactions added for ' + ticker, 'success');
      })
      .catch(function (err) {
        Utils.hideLoading();
        Utils.showMessage('Error: ' + err.message, 'error');
      });
  }

  function setStatus(message, type) {
    var area = document.getElementById('recon-status');
    var msg = document.getElementById('recon-status-msg');
    area.classList.remove('hidden');
    msg.className = 'alert alert-' + (type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
    msg.textContent = message;
  }

  window.initReconciliation = initReconciliation;
})();
