/**
 * Transactions Page — History list + filters + manual entry form.
 */
(function () {
  'use strict';

  var allTransactions = [];

  function initTransactions() {
    Utils.showLoading();

    SheetsAPI.readSheet('transactions')
      .then(function (rawTxns) {
        allTransactions = rawTxns.map(function (t) {
          var dateStr = t.date || '';
          var parsed = Utils.parseDate(dateStr);
          return {
            date: parsed ? Utils.formatDate(parsed) : dateStr,
            type: (t.transaction_type || '').toUpperCase(),
            ticker: t.ticker || '',
            account: t.account_name || '',
            quantity: Utils.parseNumber(t.quantity),
            price: Utils.parseNumber(t.price),
            amount: Utils.parseNumber(t.amount),
          };
        });

        // Sort by date descending
        allTransactions.sort(function (a, b) {
          if (a.date > b.date) return -1;
          if (a.date < b.date) return 1;
          return 0;
        });

        populateAccountFilter();
        populateManualEntryAccounts();
        renderTable(allTransactions);
        setupFilters();
        setupManualEntry();
        Utils.hideLoading();
      })
      .catch(function (err) {
        console.error('Error loading transactions:', err);
        Utils.hideLoading();
        Utils.showMessage('Error loading data: ' + err.message, 'error');
      });
  }

  function populateAccountFilter() {
    var select = document.getElementById('txn-account');
    var seen = {};

    allTransactions.forEach(function (t) {
      if (t.account && !seen[t.account]) {
        seen[t.account] = true;
        var opt = document.createElement('option');
        opt.value = t.account; opt.textContent = t.account;
        select.appendChild(opt);
      }
    });
  }

  function populateManualEntryAccounts() {
    var select = document.getElementById('txn-new-account');
    var accounts = Object.values(Config.ACCOUNT_LAST4_MAP);
    accounts.sort().forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      select.appendChild(opt);
    });

    // Default date to today
    document.getElementById('txn-new-date').value = Utils.formatDate(new Date());
  }

  function setupFilters() {
    document.getElementById('txn-filter-btn').addEventListener('click', applyFilters);
    document.getElementById('txn-reset-btn').addEventListener('click', function () {
      document.getElementById('txn-start').value = '';
      document.getElementById('txn-end').value = '';
      document.getElementById('txn-account').value = 'All';
      document.getElementById('txn-type').value = 'All';
      document.getElementById('txn-ticker-filter').value = '';
      renderTable(allTransactions);
    });
  }

  function applyFilters() {
    var start = document.getElementById('txn-start').value;
    var end = document.getElementById('txn-end').value;
    var account = document.getElementById('txn-account').value;
    var type = document.getElementById('txn-type').value;
    var ticker = (document.getElementById('txn-ticker-filter').value || '').toUpperCase();

    var filtered = allTransactions.filter(function (t) {
      if (start && t.date < start) return false;
      if (end && t.date > end) return false;
      if (account !== 'All' && t.account !== account) return false;
      if (type !== 'All' && t.type !== type) return false;
      if (ticker && t.ticker.toUpperCase().indexOf(ticker) === -1) return false;
      return true;
    });

    renderTable(filtered);
  }

  function renderTable(txns) {
    var tbody = document.getElementById('txn-body');
    var countLabel = document.getElementById('txn-count-label');

    countLabel.textContent = txns.length + ' transactions';

    if (txns.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No transactions found</td></tr>';
      return;
    }

    // Show max 500 rows
    var showTxns = txns.slice(0, 500);

    var html = '';
    showTxns.forEach(function (t) {
      var amountClass = t.amount >= 0 ? 'positive' : 'negative';
      var badgeCls = Config.getTypeBadgeClass(t.type);

      html += '<tr>';
      html += '<td>' + Utils.esc(t.date) + '</td>';
      html += '<td><span class="badge ' + badgeCls + '">' + Utils.esc(t.type || 'OTHER') + '</span></td>';
      html += '<td>' + Utils.esc(t.ticker) + '</td>';
      html += '<td>' + Utils.esc(t.account) + '</td>';
      html += '<td class="text-right">' + Utils.formatQty(t.quantity) + '</td>';
      html += '<td class="text-right">' + Utils.formatCurrency(t.price) + '</td>';
      html += '<td class="text-right ' + amountClass + '">' + Utils.formatCurrency(t.amount) + '</td>';
      html += '</tr>';
    });

    if (txns.length > 500) {
      html += '<tr><td colspan="7" class="text-center text-muted">Showing first 500 of ' + txns.length + ' transactions</td></tr>';
    }

    tbody.innerHTML = html;
  }

  // --- Manual Entry ---
  function setupManualEntry() {
    var submitBtn = document.getElementById('txn-submit-btn');
    var qtyInput = document.getElementById('txn-new-qty');
    var priceInput = document.getElementById('txn-new-price');
    var amountInput = document.getElementById('txn-new-amount');

    // Auto-calc amount from qty * price
    function autoCalcAmount() {
      var qty = Utils.parseNumber(qtyInput.value);
      var price = Utils.parseNumber(priceInput.value);
      if (qty && price && !amountInput.dataset.manual) {
        amountInput.value = (qty * price).toFixed(2);
      }
    }
    qtyInput.addEventListener('input', autoCalcAmount);
    priceInput.addEventListener('input', autoCalcAmount);
    amountInput.addEventListener('input', function () {
      amountInput.dataset.manual = 'true';
    });

    submitBtn.addEventListener('click', function () {
      var date = document.getElementById('txn-new-date').value;
      var type = document.getElementById('txn-new-type').value;
      var ticker = document.getElementById('txn-new-ticker').value.trim().toUpperCase();
      var account = document.getElementById('txn-new-account').value;
      var qty = Utils.parseNumber(qtyInput.value);
      var price = Utils.parseNumber(priceInput.value);
      var amount = Utils.parseNumber(amountInput.value);

      if (!date || !type) {
        Utils.showMessage('Date and Type are required', 'error');
        return;
      }

      Utils.showLoading();

      // For SELL, ensure qty is positive (we'll negate in the engine)
      var txnRow = [date, type, ticker, account, qty, price, amount];

      SheetsAPI.appendRows('transactions', [txnRow])
        .then(function () {
          return PositionEngine.recalculatePositions();
        })
        .then(function () {
          Utils.hideLoading();
          Utils.showMessage('Transaction added and positions recalculated', 'success');

          // Clear form
          document.getElementById('txn-new-ticker').value = '';
          qtyInput.value = '';
          priceInput.value = '';
          amountInput.value = '';
          amountInput.dataset.manual = '';

          // Refresh
          initTransactions();
        })
        .catch(function (err) {
          Utils.hideLoading();
          Utils.showMessage('Error: ' + err.message, 'error');
        });
    });
  }

  window.initTransactions = initTransactions;
})();
