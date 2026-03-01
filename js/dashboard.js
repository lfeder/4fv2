/**
 * Dashboard — Summary cards + portfolio table with filter, sort.
 * Derives positions from transactions in-memory, prices from marks as-of selected date.
 */
(function () {
  'use strict';

  var allRows = [];
  var detailRows = [];
  var currentSort = { col: 'value', asc: false };

  // Raw data kept for re-computation on date change
  var rawTransactions = [];
  var rawAssets = [];
  var rawMarks = [];
  var rawAssetClasses = [];
  var assetMap = {};

  function initDashboard() {
    Utils.showLoading();

    Promise.all([
      SheetsAPI.readSheet('transactions'),
      SheetsAPI.readSheet('assets'),
      SheetsAPI.readSheet('marks'),
      SheetsAPI.readSheet('asset_classes'),
    ])
      .then(function (results) {
        rawTransactions = results[0];
        rawAssets = results[1];
        rawMarks = results[2];
        rawAssetClasses = results[3];

        // Asset lookup by ticker, handle both "description" and "name" columns
        assetMap = {};
        rawAssets.forEach(function (a) {
          var key = (a.ticker || '').toUpperCase();
          if (!key) return;
          // Normalize: find the name/description regardless of column header
          a._name = a.description || a.name || a.Name || a.Description || '';
          assetMap[key] = a;
        });

        // Debug: log first asset to help diagnose column names
        if (rawAssets.length > 0) {
          console.log('Asset tab columns:', Object.keys(rawAssets[0]));
        }

        populateDateDropdown();
        buildAndRender();
        setupSorting();
        setupFilters();
        setupModal();
        document.getElementById('mark-date-select').addEventListener('change', buildAndRender);
        Utils.hideLoading();
      })
      .catch(function (err) {
        console.error('Error loading dashboard:', err);
        Utils.hideLoading();
        Utils.showMessage('Error loading data: ' + Utils.errMsg(err), 'error');
      });
  }

  // --- Date dropdown ---
  function populateDateDropdown() {
    var dates = {};
    rawMarks.forEach(function (m) {
      var d = m.date || '';
      if (d) dates[d] = true;
    });

    var sorted = Object.keys(dates).sort().reverse();
    var sel = document.getElementById('mark-date-select');
    sel.innerHTML = '';
    sorted.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
  }

  // --- Build marks for selected date, then compute and render ---
  function buildAndRender() {
    var selectedDate = document.getElementById('mark-date-select').value;

    // For each ticker, find mark on selectedDate or most recent before it
    var marksByTicker = {};
    rawMarks.forEach(function (m) {
      var ticker = (m.ticker || '').toUpperCase();
      var date = m.date || '';
      if (!ticker || !date) return;
      if (date > selectedDate) return; // skip future marks
      if (!marksByTicker[ticker] || date > marksByTicker[ticker].date) {
        marksByTicker[ticker] = { date: date, price: Utils.parseNumber(m.price) };
      }
    });

    // Derive positions from transactions (qty/cost per ticker+account)
    var derived = PositionEngine.derivePositionsFromData(rawTransactions, rawMarks);

    // Build detail rows (per ticker+account)
    detailRows = derived.map(function (p) {
      var ticker = (p.ticker || '').toUpperCase();
      var account = p.account_name || '';
      var asset = assetMap[ticker] || {};
      var owner = Config.getOwner(account);
      var qty = Utils.parseNumber(p.qty);
      var cost = Utils.parseNumber(p.cost);
      var mark = marksByTicker[ticker];
      var price = mark ? mark.price : 0;
      var markDate = mark ? mark.date : '';
      var value = qty * price;
      var pnl = value - cost;
      var pnlPct = cost !== 0 ? (pnl / Math.abs(cost)) * 100 : 0;

      return {
        ticker: p.ticker || '',
        name: asset._name || '',
        asset_class: asset.asset_class || '',
        account: account,
        owner: owner,
        qty: qty,
        price: price,
        mark_date: markDate,
        cost: cost,
        value: value,
        pnl: pnl,
        pnl_pct: pnlPct,
      };
    });

    // Aggregate by ticker for the main table
    var tickerAgg = {};
    detailRows.forEach(function (r) {
      var key = r.ticker.toUpperCase();
      if (!tickerAgg[key]) {
        tickerAgg[key] = {
          ticker: r.ticker,
          name: r.name,
          asset_class: r.asset_class,
          qty: 0,
          price: r.price,
          mark_date: r.mark_date,
          cost: 0,
          value: 0,
          pnl: 0,
        };
      }
      tickerAgg[key].qty += r.qty;
      tickerAgg[key].cost += r.cost;
      tickerAgg[key].value += r.value;
      tickerAgg[key].pnl += r.pnl;
      if (!tickerAgg[key].name && r.name) tickerAgg[key].name = r.name;
      if (!tickerAgg[key].asset_class && r.asset_class) tickerAgg[key].asset_class = r.asset_class;
      if (!tickerAgg[key].mark_date && r.mark_date) tickerAgg[key].mark_date = r.mark_date;
    });

    allRows = Object.keys(tickerAgg).map(function (key) {
      var r = tickerAgg[key];
      r.pnl_pct = r.cost !== 0 ? (r.pnl / Math.abs(r.cost)) * 100 : 0;
      return r;
    });

    populateModalDropdowns();
    renderSummaryTables();
    sortAndRender();
  }

  // --- Selection state for summary table filtering ---
  var selectedAccounts = {};
  var selectedClasses = {};

  function toggleSelection(map, key) {
    if (map[key]) { delete map[key]; } else { map[key] = true; }
  }

  // --- Summary Tables ---
  function renderSummaryTables() {
    renderAccountTable();
    renderAllocationTable();
  }

  function renderAccountTable() {
    var byAccount = {};
    var total = 0;

    detailRows.forEach(function (r) {
      var acct = r.account || 'Unknown';
      if (!byAccount[acct]) byAccount[acct] = 0;
      byAccount[acct] += r.value;
      total += r.value;
    });

    var sorted = Object.keys(byAccount).sort(function (a, b) { return byAccount[b] - byAccount[a]; });
    var tbody = document.getElementById('account-body');
    var tfoot = document.getElementById('account-foot');

    tbody.innerHTML = sorted.map(function (acct) {
      var val = byAccount[acct];
      var pct = total > 0 ? (val / total * 100) : 0;
      var sel = selectedAccounts[acct] ? ' class="selected"' : '';
      return '<tr' + sel + ' data-acct="' + Utils.esc(acct) + '"><td>' + Utils.esc(acct) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(val) + '</td>' +
        '<td class="text-right">' + pct.toFixed(1) + '%</td></tr>';
    }).join('');

    tfoot.innerHTML = '<tr><th>Total</th><th class="text-right">' + Utils.formatCurrency(total) + '</th><th class="text-right">100%</th></tr>';

    tbody.querySelectorAll('tr[data-acct]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        toggleSelection(selectedAccounts, tr.getAttribute('data-acct'));
        renderAccountTable();
        sortAndRender();
      });
    });
  }

  function renderAllocationTable() {
    var byClass = {};
    var total = 0;

    allRows.forEach(function (r) {
      var cls = r.asset_class || 'Other';
      if (!byClass[cls]) byClass[cls] = 0;
      byClass[cls] += r.value;
      total += r.value;
    });

    var sorted = Object.keys(byClass).sort(function (a, b) { return byClass[b] - byClass[a]; });
    var tbody = document.getElementById('allocation-body');
    var tfoot = document.getElementById('allocation-foot');

    tbody.innerHTML = sorted.map(function (cls) {
      var val = byClass[cls];
      var pct = total > 0 ? (val / total * 100) : 0;
      var sel = selectedClasses[cls] ? ' class="selected"' : '';
      return '<tr' + sel + ' data-cls="' + Utils.esc(cls) + '"><td>' + Utils.esc(cls) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(val) + '</td>' +
        '<td class="text-right">' + pct.toFixed(1) + '%</td></tr>';
    }).join('');

    tfoot.innerHTML = '<tr><th>Total</th><th class="text-right">' + Utils.formatCurrency(total) + '</th><th class="text-right">100%</th></tr>';

    tbody.querySelectorAll('tr[data-cls]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        toggleSelection(selectedClasses, tr.getAttribute('data-cls'));
        renderAllocationTable();
        sortAndRender();
      });
    });
  }

  // --- Filters ---
  function populateModalDropdowns() {
    var accts = {};
    detailRows.forEach(function (r) {
      if (r.account) accts[r.account] = true;
    });

    var modalAcct = document.getElementById('new-account');
    modalAcct.innerHTML = '';
    Object.keys(accts).sort().forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      modalAcct.appendChild(opt);
    });

    var modalClass = document.getElementById('new-asset-class');
    modalClass.innerHTML = '<option value="">Select...</option>';
    rawAssetClasses.forEach(function (ac) {
      var name = ac.asset_class || '';
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      modalClass.appendChild(opt);
    });
  }

  function getFilteredRows() {
    var search = (document.getElementById('filter-search').value || '').toLowerCase();
    var hasAcctFilter = Object.keys(selectedAccounts).length > 0;
    var hasClassFilter = Object.keys(selectedClasses).length > 0;

    if (hasAcctFilter || hasClassFilter) {
      var filtered = detailRows.filter(function (r) {
        if (hasAcctFilter && !selectedAccounts[r.account]) return false;
        if (hasClassFilter && !selectedClasses[r.asset_class || 'Other']) return false;
        if (search && r.ticker.toLowerCase().indexOf(search) === -1 &&
            r.name.toLowerCase().indexOf(search) === -1) return false;
        return true;
      });

      var agg = {};
      filtered.forEach(function (r) {
        var key = r.ticker.toUpperCase();
        if (!agg[key]) {
          agg[key] = {
            ticker: r.ticker, name: r.name, asset_class: r.asset_class,
            qty: 0, price: r.price, mark_date: r.mark_date, cost: 0, value: 0, pnl: 0,
          };
        }
        agg[key].qty += r.qty;
        agg[key].cost += r.cost;
        agg[key].value += r.value;
        agg[key].pnl += r.pnl;
      });

      return Object.keys(agg).map(function (key) {
        var r = agg[key];
        r.pnl_pct = r.cost !== 0 ? (r.pnl / Math.abs(r.cost)) * 100 : 0;
        return r;
      });
    }

    return allRows.filter(function (r) {
      if (search && r.ticker.toLowerCase().indexOf(search) === -1 &&
          r.name.toLowerCase().indexOf(search) === -1) return false;
      return true;
    });
  }

  function setupFilters() {
    document.getElementById('filter-search').addEventListener('input', sortAndRender);
  }

  // --- Sorting ---
  function setupSorting() {
    var headers = document.querySelectorAll('#dashboard-table thead th[data-col]');
    headers.forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-col');
        if (currentSort.col === col) {
          currentSort.asc = !currentSort.asc;
        } else {
          currentSort.col = col;
          currentSort.asc = true;
        }
        sortAndRender();
      });
    });
  }

  function sortAndRender() {
    var rows = getFilteredRows();
    var col = currentSort.col;
    var asc = currentSort.asc;

    rows.sort(function (a, b) {
      var va = a[col]; var vb = b[col];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return 0;
    });

    renderTable(rows);
  }

  // --- Rendering ---
  function renderTable(rows) {
    var tbody = document.getElementById('dashboard-body');
    var tfoot = document.getElementById('dashboard-foot');

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">No positions found</td></tr>';
      tfoot.innerHTML = '';
      return;
    }

    var totalValue = 0, totalCost = 0, totalPnl = 0;

    var html = '';
    rows.forEach(function (r) {
      totalValue += r.value;
      totalCost += r.cost;
      totalPnl += r.pnl;

      var pnlClass = r.pnl >= 0 ? 'positive' : 'negative';

      html += '<tr data-ticker="' + Utils.esc(r.ticker) + '">';
      html += '<td>' + Utils.esc(r.ticker) + '</td>';
      html += '<td>' + Utils.esc(r.name) + '</td>';
      html += '<td>' + Utils.esc(r.asset_class) + '</td>';
      html += '<td class="text-right">' + Utils.formatQty(r.qty) + '</td>';
      html += '<td class="text-right">' + Utils.formatCurrency(r.price) + '</td>';
      html += '<td>' + Utils.esc(r.mark_date) + '</td>';
      html += '<td class="text-right">' + Utils.formatCurrency(r.cost) + '</td>';
      html += '<td class="text-right">' + Utils.formatCurrency(r.value) + '</td>';
      html += '<td class="text-right ' + pnlClass + '">' + Utils.formatCurrency(r.pnl) + '</td>';
      html += '<td class="text-right ' + pnlClass + '">' + Utils.formatPercent(r.pnl_pct) + '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;

    var totalPnlPct = totalCost !== 0 ? (totalPnl / Math.abs(totalCost)) * 100 : 0;
    var pnlClass = totalPnl >= 0 ? 'positive' : 'negative';
    tfoot.innerHTML =
      '<tr>' +
      '<th colspan="3">Totals (' + rows.length + ' positions)</th>' +
      '<th></th><th></th><th></th>' +
      '<th class="text-right">' + Utils.formatCurrency(totalCost) + '</th>' +
      '<th class="text-right">' + Utils.formatCurrency(totalValue) + '</th>' +
      '<th class="text-right ' + pnlClass + '">' + Utils.formatCurrency(totalPnl) + '</th>' +
      '<th class="text-right ' + pnlClass + '">' + Utils.formatPercent(totalPnlPct) + '</th>' +
      '</tr>';
  }

  // --- Add Asset Modal ---
  function setupModal() {
    var modal = document.getElementById('add-asset-modal');
    var openBtn = document.getElementById('add-asset-btn');
    var closeBtn = document.getElementById('close-modal-btn');
    var cancelBtn = document.getElementById('cancel-asset-btn');
    var saveBtn = document.getElementById('save-asset-btn');
    var nameInput = document.getElementById('new-name');
    var tickerInput = document.getElementById('new-ticker');

    function showModal() { modal.classList.remove('hidden'); modal.style.display = 'flex'; }
    function hideModal() { modal.classList.add('hidden'); modal.style.display = 'none'; }

    openBtn.addEventListener('click', showModal);
    closeBtn.addEventListener('click', hideModal);
    cancelBtn.addEventListener('click', hideModal);

    nameInput.addEventListener('input', function () {
      if (!tickerInput.dataset.manual) {
        tickerInput.value = Utils.generateTicker(nameInput.value);
      }
    });
    tickerInput.addEventListener('input', function () {
      tickerInput.dataset.manual = 'true';
    });

    saveBtn.addEventListener('click', function () {
      var ticker = tickerInput.value.trim().toUpperCase();
      var name = nameInput.value.trim();
      var assetClass = document.getElementById('new-asset-class').value.trim();
      var account = document.getElementById('new-account').value.trim();
      var qty = Utils.parseNumber(document.getElementById('new-qty').value);
      var price = Utils.parseNumber(document.getElementById('new-price').value);
      var cost = Utils.parseNumber(document.getElementById('new-cost').value);
      var today = Utils.formatDate(new Date());

      if (!ticker || !name) {
        Utils.showMessage('Ticker and Name are required', 'error');
        return;
      }

      // Validate ticker: letters, numbers, dots, underscores only, max 20 chars
      if (!/^[A-Z0-9._-]{1,20}$/.test(ticker)) {
        Utils.showMessage('Ticker must be 1-20 characters: letters, numbers, dots, dashes', 'error');
        return;
      }

      // Check for duplicate ticker
      if (assetMap[ticker]) {
        Utils.showMessage('Ticker "' + ticker + '" already exists', 'error');
        return;
      }

      Utils.showLoading();

      SheetsAPI.appendRows('assets', [[ticker, name, assetClass]])
        .then(function () {
          return SheetsAPI.appendRows('marks', [[ticker, today, price]]);
        })
        .then(function () {
          return SheetsAPI.appendRows('transactions', [
            [today, 'INITIAL_COST_BASIS', ticker, account, qty, price, cost],
          ]);
        })
        .then(function () {
          return PositionEngine.recalculatePositions();
        })
        .then(function () {
          Utils.hideLoading();
          Utils.showMessage('Asset "' + ticker + '" added', 'success');
          hideModal();
          initDashboard();
        })
        .catch(function (err) {
          console.error('Save asset error:', err);
          Utils.hideLoading();
          Utils.showMessage('Error: ' + Utils.errMsg(err), 'error');
        });
    });
  }

  window.initDashboard = initDashboard;
})();
