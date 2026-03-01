/**
 * Performance — TWR from marks + cash flows.
 * Uses positions derived from marks at each date, with cash flow adjustments
 * from TRANSFER, CAPITAL_CALL, DISTRIBUTION, SWEEP transactions.
 */
(function () {
  'use strict';

  var allPeriods = [];
  var allCashFlows = [];
  var allTransactions = [];
  var allPositions = [];

  function initPerformance() {
    Utils.showLoading();

    Promise.all([
      SheetsAPI.readSheet('positions'),
      SheetsAPI.readSheet('marks'),
      SheetsAPI.readSheet('transactions'),
    ])
      .then(function (results) {
        allPositions = results[0];
        var marks = results[1];
        allTransactions = results[2];

        // Build portfolio value by date from marks + positions
        var valueByDate = buildValueByDate(marks, allPositions, allTransactions);

        // Build cash flows
        allCashFlows = buildCashFlows(allTransactions);
        var cashFlowByDate = {};
        allCashFlows.forEach(function (cf) {
          if (!cashFlowByDate[cf.date]) cashFlowByDate[cf.date] = 0;
          cashFlowByDate[cf.date] += cf.amount;
        });

        // Calculate TWR periods
        allPeriods = calculateTWR(valueByDate, cashFlowByDate);

        populateFilters();
        renderAll(allPeriods, allCashFlows);
        setupFilters();
        Utils.hideLoading();
      })
      .catch(function (err) {
        console.error('Error loading performance:', err);
        Utils.hideLoading();
        Utils.showMessage('Error loading data: ' + err.message, 'error');
      });
  }

  function buildValueByDate(marks, positions, transactions) {
    // Group marks by date, then for each date sum (qty * mark_price) for each position
    // For simplicity, use the positions tab (latest snapshot) and marks for historical dates

    // Get all unique mark dates
    var marksByDate = {};
    marks.forEach(function (m) {
      var date = m.date || '';
      var ticker = m.ticker || '';
      var price = Utils.parseNumber(m.price);
      if (!date || !ticker) return;
      if (!marksByDate[date]) marksByDate[date] = {};
      marksByDate[date][ticker] = price;
    });

    // Get position quantities (from latest positions tab)
    var posQty = {};
    positions.forEach(function (p) {
      var key = (p.ticker || '') + '|' + (p.account_name || '');
      posQty[key] = Utils.parseNumber(p.qty);
    });

    // For each date with marks, compute portfolio value
    var valueByDate = {};
    var dates = Object.keys(marksByDate).sort();

    dates.forEach(function (date) {
      var dateMarks = marksByDate[date];
      var totalValue = 0;

      Object.keys(posQty).forEach(function (key) {
        var ticker = key.split('|')[0];
        var qty = posQty[key];
        var price = dateMarks[ticker];
        if (price !== undefined) {
          totalValue += qty * price;
        }
      });

      if (totalValue > 0) {
        valueByDate[date] = totalValue;
      }
    });

    return valueByDate;
  }

  function buildCashFlows(transactions) {
    var cashFlows = [];
    var cashFlowTypes = Config.CASH_FLOW_TYPES;

    transactions.forEach(function (t) {
      var type = (t.transaction_type || '').toUpperCase();
      if (cashFlowTypes.indexOf(type) === -1) return;

      var parsed = Utils.parseDate(t.date);
      var date = parsed ? Utils.formatDate(parsed) : '';
      if (!date) return;

      cashFlows.push({
        date: date,
        type: type,
        ticker: t.ticker || '',
        account: t.account_name || '',
        amount: Utils.parseNumber(t.amount),
      });
    });

    cashFlows.sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });

    return cashFlows;
  }

  function calculateTWR(valueByDate, cashFlowByDate) {
    var dates = Object.keys(valueByDate).sort();
    if (dates.length === 0) return [];

    var periods = [];
    var cumulativeTWR = 1.0;

    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var portfolioValue = valueByDate[date];
      var netCashFlow = cashFlowByDate[date] || 0;

      if (i === 0) {
        periods.push({
          date: date,
          portfolioValue: portfolioValue,
          netCashFlow: netCashFlow,
          periodChange: 0,
          changePct: 0,
          cumulativeTWR: 0,
        });
        continue;
      }

      var prevValue = valueByDate[dates[i - 1]];
      var periodChange = portfolioValue - prevValue - netCashFlow;
      var changePct = prevValue !== 0 ? (periodChange / prevValue) * 100 : 0;

      // TWR: (end_value - net_cash_flow) / start_value
      var periodReturn = prevValue !== 0 ? (portfolioValue - netCashFlow) / prevValue : 1;
      cumulativeTWR *= periodReturn;

      periods.push({
        date: date,
        portfolioValue: portfolioValue,
        netCashFlow: netCashFlow,
        periodChange: periodChange,
        changePct: changePct,
        cumulativeTWR: (cumulativeTWR - 1) * 100,
      });
    }

    return periods;
  }

  // --- Filters ---
  function populateFilters() {
    var ownerSelect = document.getElementById('perf-owner');
    var accountSelect = document.getElementById('perf-account');

    var owners = {};
    var accounts = {};
    allPositions.forEach(function (p) {
      var acct = p.account_name || '';
      var owner = Config.getOwner(acct);
      if (owner) owners[owner] = true;
      if (acct) accounts[acct] = true;
    });

    Object.keys(owners).sort().forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      ownerSelect.appendChild(opt);
    });

    Object.keys(accounts).sort().forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      accountSelect.appendChild(opt);
    });
  }

  function setupFilters() {
    document.getElementById('perf-filter-btn').addEventListener('click', function () {
      var start = document.getElementById('perf-start').value;
      var end = document.getElementById('perf-end').value;

      var filtered = allPeriods.filter(function (p) {
        if (start && p.date < start) return false;
        if (end && p.date > end) return false;
        return true;
      });

      var filteredCF = allCashFlows.filter(function (cf) {
        if (start && cf.date < start) return false;
        if (end && cf.date > end) return false;
        return true;
      });

      renderAll(filtered, filteredCF);
    });

    document.getElementById('perf-reset-btn').addEventListener('click', function () {
      document.getElementById('perf-start').value = '';
      document.getElementById('perf-end').value = '';
      document.getElementById('perf-owner').value = 'All';
      document.getElementById('perf-account').value = 'All';
      renderAll(allPeriods, allCashFlows);
    });
  }

  // --- Rendering ---
  function renderAll(periods, cashFlows) {
    renderMetrics(periods, cashFlows);
    renderTable(periods);
    renderChart(periods);
    renderCashFlows(cashFlows);
  }

  function renderMetrics(periods, cashFlows) {
    if (periods.length === 0) {
      document.getElementById('latest-value').textContent = '--';
      document.getElementById('period-return').textContent = '--';
      document.getElementById('twr-pct').textContent = '--';
      document.getElementById('net-cash-flow').textContent = '--';
      return;
    }

    var last = periods[periods.length - 1];
    var first = periods[0];
    var periodReturn = last.portfolioValue - first.portfolioValue;
    var totalCF = 0;
    cashFlows.forEach(function (cf) { totalCF += cf.amount; });

    document.getElementById('latest-value').textContent = Utils.formatCurrency(last.portfolioValue);
    document.getElementById('period-return').textContent = Utils.formatCurrency(periodReturn);
    document.getElementById('twr-pct').textContent = Utils.formatPercent(last.cumulativeTWR);
    document.getElementById('net-cash-flow').textContent = Utils.formatCurrency(totalCF);
  }

  function renderTable(periods) {
    var tbody = document.getElementById('perf-body');
    if (periods.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No data available</td></tr>';
      return;
    }

    tbody.innerHTML = periods.map(function (p) {
      var changeClass = p.periodChange >= 0 ? 'positive' : 'negative';
      return '<tr>' +
        '<td>' + p.date + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(p.portfolioValue) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(p.netCashFlow) + '</td>' +
        '<td class="text-right ' + changeClass + '">' + Utils.formatCurrency(p.periodChange) + '</td>' +
        '<td class="text-right ' + changeClass + '">' + Utils.formatPercent(p.changePct) + '</td>' +
        '<td class="text-right">' + Utils.formatPercent(p.cumulativeTWR) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderChart(periods) {
    var chart = document.getElementById('perf-chart');
    chart.innerHTML = '';
    if (periods.length === 0) return;

    var maxValue = 0;
    periods.forEach(function (p) { if (p.portfolioValue > maxValue) maxValue = p.portfolioValue; });
    if (maxValue === 0) return;

    periods.forEach(function (p) {
      var heightPct = (p.portfolioValue / maxValue) * 100;
      var bar = document.createElement('div');
      bar.style.cssText =
        'flex:1;min-width:4px;max-width:40px;' +
        'background:linear-gradient(to top, #2E86AB, #1a6485);' +
        'height:' + heightPct + '%;border-radius:2px 2px 0 0;' +
        'position:relative;cursor:pointer;transition:opacity 0.15s;';
      bar.title = p.date + ': ' + Utils.formatCurrency(p.portfolioValue);
      bar.addEventListener('mouseenter', function () { bar.style.opacity = '0.8'; });
      bar.addEventListener('mouseleave', function () { bar.style.opacity = '1'; });
      chart.appendChild(bar);
    });
  }

  function renderCashFlows(cashFlows) {
    var tbody = document.getElementById('cashflow-body');
    if (cashFlows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No cash flows found</td></tr>';
      return;
    }

    var show = cashFlows.slice(0, 200);
    tbody.innerHTML = show.map(function (cf) {
      var amtClass = cf.amount >= 0 ? 'positive' : 'negative';
      var badgeCls = Config.getTypeBadgeClass(cf.type);
      return '<tr>' +
        '<td>' + Utils.esc(cf.date) + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + Utils.esc(cf.type) + '</span></td>' +
        '<td>' + Utils.esc(cf.ticker) + '</td>' +
        '<td>' + Utils.esc(cf.account) + '</td>' +
        '<td class="text-right ' + amtClass + '">' + Utils.formatCurrency(cf.amount) + '</td>' +
        '</tr>';
    }).join('');
  }

  window.initPerformance = initPerformance;
})();
