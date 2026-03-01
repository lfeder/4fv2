/**
 * Forecaster — Asset class aggregation + growth projection.
 * Groups by asset class across 3 owners (LFRM, JJB, Juju).
 */
(function () {
  'use strict';

  var aggregatedData = [];
  var grandTotal = 0;

  var INCOME_YIELDS = {
    'Fixed Income & Cash': 0.04,
    'Equity': 0.018,
    'Real Estate': 0.035,
    'Cash': 0.045,
    'Alternative': 0.02,
    'Private Equity': 0.01,
    'Other': 0.02,
  };
  var DEFAULT_YIELD = 0.02;

  function initForecaster() {
    Utils.showLoading();

    Promise.all([
      SheetsAPI.readSheet('positions'),
      SheetsAPI.readSheet('assets'),
    ])
      .then(function (results) {
        var positions = results[0];
        var assets = results[1];

        // Asset lookup
        var assetMap = {};
        assets.forEach(function (a) {
          assetMap[(a.ticker || '').toUpperCase()] = a;
        });

        // Aggregate by asset class and owner
        var byClass = {};

        positions.forEach(function (p) {
          var ticker = p.ticker || '';
          var account = p.account_name || '';
          var asset = assetMap[ticker.toUpperCase()] || {};
          var assetClass = asset.asset_class || 'Other';
          var owner = Config.getOwner(account) || 'Other';
          var value = Utils.parseNumber(p.value) || (Utils.parseNumber(p.qty) * Utils.parseNumber(p.price));

          if (!byClass[assetClass]) {
            byClass[assetClass] = { LFRM: 0, JJB: 0, Juju: 0, Other: 0 };
          }
          if (byClass[assetClass][owner] !== undefined) {
            byClass[assetClass][owner] += value;
          } else {
            byClass[assetClass].Other += value;
          }
        });

        aggregatedData = [];
        grandTotal = 0;

        Object.keys(byClass).sort().forEach(function (cls) {
          var entry = byClass[cls];
          var total = entry.LFRM + entry.JJB + entry.Juju + entry.Other;
          var yieldRate = getYield(cls);
          var estIncome = total * yieldRate;

          grandTotal += total;
          aggregatedData.push({
            assetClass: cls,
            lfrm: entry.LFRM,
            jjb: entry.JJB,
            juju: entry.Juju,
            totalValue: total,
            estIncome: estIncome,
          });
        });

        aggregatedData.sort(function (a, b) { return b.totalValue - a.totalValue; });

        renderForecastTable();
        setupSimulation();
        Utils.hideLoading();
      })
      .catch(function (err) {
        console.error('Error loading forecaster:', err);
        Utils.hideLoading();
        Utils.showMessage('Error loading data: ' + err.message, 'error');
      });
  }

  function getYield(assetClass) {
    if (INCOME_YIELDS[assetClass] !== undefined) return INCOME_YIELDS[assetClass];
    var lower = assetClass.toLowerCase();
    var keys = Object.keys(INCOME_YIELDS);
    for (var i = 0; i < keys.length; i++) {
      if (lower.indexOf(keys[i].toLowerCase()) !== -1) {
        return INCOME_YIELDS[keys[i]];
      }
    }
    return DEFAULT_YIELD;
  }

  function renderForecastTable() {
    var tbody = document.getElementById('forecast-body');
    var tfoot = document.getElementById('forecast-foot');

    if (aggregatedData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No data available</td></tr>';
      tfoot.innerHTML = '';
      return;
    }

    var totals = { lfrm: 0, jjb: 0, juju: 0, total: 0, income: 0 };

    tbody.innerHTML = aggregatedData.map(function (d) {
      totals.lfrm += d.lfrm;
      totals.jjb += d.jjb;
      totals.juju += d.juju;
      totals.total += d.totalValue;
      totals.income += d.estIncome;

      var pct = grandTotal > 0 ? (d.totalValue / grandTotal * 100).toFixed(1) : '0.0';

      return '<tr>' +
        '<td>' + Utils.esc(d.assetClass) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(d.lfrm) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(d.jjb) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(d.juju) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(d.totalValue) + '</td>' +
        '<td class="text-right">' + pct + '%</td>' +
        '<td class="text-right">' + Utils.formatCurrency(d.estIncome) + '</td>' +
        '</tr>';
    }).join('');

    tfoot.innerHTML =
      '<tr>' +
      '<th>Total</th>' +
      '<th class="text-right">' + Utils.formatCurrency(totals.lfrm) + '</th>' +
      '<th class="text-right">' + Utils.formatCurrency(totals.jjb) + '</th>' +
      '<th class="text-right">' + Utils.formatCurrency(totals.juju) + '</th>' +
      '<th class="text-right">' + Utils.formatCurrency(totals.total) + '</th>' +
      '<th class="text-right">100%</th>' +
      '<th class="text-right">' + Utils.formatCurrency(totals.income) + '</th>' +
      '</tr>';
  }

  function setupSimulation() {
    document.getElementById('simulate-btn').addEventListener('click', runSimulation);
  }

  function runSimulation() {
    var growthRate = Utils.parseNumber(document.getElementById('growth-rate').value) / 100;
    var years = parseInt(document.getElementById('growth-years').value, 10) || 10;

    if (growthRate <= 0 || years <= 0) {
      Utils.showMessage('Please enter valid growth rate and years', 'error');
      return;
    }

    var totalIncome = 0;
    aggregatedData.forEach(function (d) { totalIncome += d.estIncome; });
    var incomeYield = grandTotal > 0 ? totalIncome / grandTotal : DEFAULT_YIELD;

    var projections = [];
    var currentValue = grandTotal;

    for (var y = 0; y <= years; y++) {
      var annualGrowth = y === 0 ? 0 : currentValue * growthRate;
      if (y > 0) currentValue += annualGrowth;
      var annualIncome = currentValue * incomeYield;

      projections.push({
        year: y,
        value: currentValue,
        growth: annualGrowth,
        income: annualIncome,
      });
    }

    renderSimulation(projections);
  }

  function renderSimulation(projections) {
    var area = document.getElementById('simulation-area');
    var tbody = document.getElementById('simulation-body');
    area.classList.remove('hidden');

    tbody.innerHTML = projections.map(function (p) {
      var growthClass = p.growth >= 0 ? 'positive' : 'negative';
      return '<tr>' +
        '<td>' + (p.year === 0 ? 'Current' : 'Year ' + p.year) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(p.value) + '</td>' +
        '<td class="text-right ' + growthClass + '">' + Utils.formatCurrency(p.growth) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(p.income) + '</td>' +
        '</tr>';
    }).join('');
  }

  window.initForecaster = initForecaster;
})();
