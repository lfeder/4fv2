/**
 * Position Derivation Engine
 * Reads transactions tab, computes qty/cost for every (ticker, account) pair,
 * writes results to the positions tab.
 */
(function () {
  'use strict';

  /**
   * Derive positions from transaction rows.
   * @param {Array<Object>} transactions - rows from the transactions tab
   * @param {Array<Object>} marks - rows from the marks tab (for latest prices)
   * @returns {Array<Object>} derived positions
   */
  function derivePositions(transactions, marks) {
    // Build latest mark price per ticker (case-insensitive)
    var latestMark = {};
    (marks || []).forEach(function (m) {
      var ticker = (m.ticker || '').toUpperCase();
      var date = m.date || '';
      var price = Utils.parseNumber(m.price);
      if (!ticker) return;
      if (!latestMark[ticker] || date > latestMark[ticker].date) {
        latestMark[ticker] = { date: date, price: price };
      }
    });

    // Group transactions by (ticker, account)
    var groups = {};
    transactions.forEach(function (t) {
      var ticker = t.ticker || '';
      var account = t.account_name || '';
      var key = ticker.toUpperCase() + '|' + account;
      if (!groups[key]) {
        groups[key] = { ticker: ticker, account: account, txns: [] };
      }
      groups[key].txns.push(t);
    });

    var positions = [];

    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      var ticker = group.ticker;
      var account = group.account;

      // Sort by date ASC
      group.txns.sort(function (a, b) {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        // Within same date, INITIAL_COST_BASIS before others
        var order = { 'INITIAL_COST_BASIS': 0 };
        var oa = order[a.transaction_type] !== undefined ? order[a.transaction_type] : 2;
        var ob = order[b.transaction_type] !== undefined ? order[b.transaction_type] : 2;
        return oa - ob;
      });

      var qty = 0;
      var cost = 0;

      group.txns.forEach(function (t) {
        var type = (t.transaction_type || '').toUpperCase();
        var tQty = Utils.parseNumber(t.quantity);
        var tPrice = Utils.parseNumber(t.price);
        var tAmount = Utils.parseNumber(t.amount);

        switch (type) {
          case 'INITIAL_COST_BASIS':
            qty += tQty;
            cost += tAmount;
            break;

          case 'BUY':
            var buyQty = Math.abs(tQty);
            qty += buyQty;
            cost += Math.abs(tAmount) || (buyQty * tPrice);
            break;

          case 'REINVEST':
            var reinvestQty = Math.abs(tQty);
            qty += reinvestQty;
            cost += Math.abs(tAmount) || (reinvestQty * tPrice);
            break;

          case 'SELL':
            var sellQty = Math.abs(tQty);
            if (qty > 0 && sellQty > 0) {
              var avgCost = cost / qty;
              cost -= sellQty * avgCost;
            }
            qty -= sellQty;
            break;

          case 'COST_ADJUSTMENT':
            cost += tAmount;
            break;

          case 'EXCHANGE':
            if (tQty < 0) {
              var exchSellQty = Math.abs(tQty);
              if (qty > 0 && exchSellQty > 0) {
                var exchAvg = cost / qty;
                cost -= exchSellQty * exchAvg;
              }
              qty -= exchSellQty;
            } else if (tQty > 0) {
              qty += tQty;
              cost += Math.abs(tAmount) || (tQty * tPrice);
            }
            break;

          default:
            break;
        }
      });

      // Skip positions with zero qty and zero cost
      if (qty === 0 && cost === 0) return;

      var mark = latestMark[ticker.toUpperCase()];
      var price = mark ? mark.price : 0;
      var value = qty * price;
      var markDate = mark ? mark.date : '';

      positions.push({
        date: markDate || Utils.formatDate(new Date()),
        account_name: account,
        ticker: ticker,
        qty: qty,
        price: price,
        value: value,
        cost: cost,
      });
    });

    return positions;
  }

  /**
   * Full recalculation: read transactions + marks, compute positions, write to sheet.
   */
  function recalculatePositions() {
    return Promise.all([
      SheetsAPI.readSheet('transactions'),
      SheetsAPI.readSheet('marks'),
    ]).then(function (results) {
      var transactions = results[0];
      var marks = results[1];

      var positions = derivePositions(transactions, marks);

      var header = ['date', 'account_name', 'ticker', 'qty', 'price', 'value', 'cost'];
      var data = [header];
      positions.forEach(function (p) {
        data.push([
          p.date,
          p.account_name,
          p.ticker,
          p.qty,
          p.price,
          p.value,
          p.cost,
        ]);
      });

      return SheetsAPI.clearAndWriteSheet('positions', data).then(function () {
        return positions;
      });
    });
  }

  function derivePositionsFromData(transactions, marks) {
    return derivePositions(transactions, marks);
  }

  window.PositionEngine = {
    derivePositions: derivePositions,
    derivePositionsFromData: derivePositionsFromData,
    recalculatePositions: recalculatePositions,
  };
})();
