/**
 * CSV Parser — Generic CSV text parsing + JPM column normalization.
 */
(function () {
  'use strict';

  /**
   * Parse CSV text into { headers, rows } where rows is an array of objects.
   */
  function parseCSV(text) {
    var lines = text.split(/\r?\n/);
    if (lines.length < 2) return { headers: [], rows: [] };

    var headers = splitCSVLine(lines[0]);
    var rows = [];

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var values = splitCSVLine(line);
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j].trim()] = (values[j] || '').trim();
      }
      rows.push(obj);
    }

    return { headers: headers.map(function (h) { return h.trim(); }), rows: rows };
  }

  function splitCSVLine(line) {
    var result = [];
    var current = '';
    var inQuotes = false;

    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Normalize a JPM position CSV row to our standard fields.
   * JPM columns: Asset Class, Description, Ticker, Quantity, Price, Value, Cost, As of
   */
  function normalizePositionRow(row) {
    var ticker = (row['Ticker'] || row['ticker'] || '').trim();
    // Remove leading ** from JPM descriptions
    var description = (row['Description'] || row['description'] || '').replace(/^\*+/, '').trim();
    var assetClass = (row['Asset Class'] || row['asset_class'] || '').trim();
    var quantity = Utils.parseNumber(row['Quantity'] || row['quantity'] || row['qty']);
    var price = Utils.parseNumber(row['Price'] || row['price']);
    var value = Utils.parseNumber(row['Value'] || row['value'] || row['Market Value']);
    var cost = Utils.parseNumber(row['Cost'] || row['cost'] || row['Cost Basis']);
    var estIncome = Utils.parseNumber(row['Est. Annual Income'] || row['est_annual_income'] || 0);

    // Parse date from "MM/DD/YYYY HH:MM:SS" or "MM/DD/YYYY" format
    var rawDate = row['As of'] || row['as_of'] || row['date'] || row['Date'] || '';
    var parsed = Utils.parseDate(rawDate);
    var date = parsed ? Utils.formatDate(parsed) : Utils.formatDate(new Date());

    if (value === 0 && quantity !== 0 && price !== 0) {
      value = quantity * price;
    }

    return {
      ticker: ticker,
      description: description,
      asset_class: assetClass,
      quantity: quantity,
      price: price,
      value: value,
      cost: cost,
      date: date,
      est_annual_income: estIncome,
    };
  }

  /**
   * Normalize a JPM transaction CSV row to our standard fields.
   * JPM columns: Trade Date, Account Name, Account Number, Type, Description, Ticker,
   *              Price USD, Quantity, Amount USD
   */
  function normalizeTransactionRow(row) {
    var rawDate = row['Trade Date'] || row['date'] || row['Date'] || '';
    var parsed = Utils.parseDate(rawDate);
    var date = parsed ? Utils.formatDate(parsed) : '';

    var rawType = (row['Type'] || row['type'] || row['Transaction Type'] || '').trim();
    var normalizedType = Config.normalizeType(rawType);

    var ticker = (row['Ticker'] || row['ticker'] || row['Symbol'] || '').trim();
    var rawAccount = (row['Account Name'] || row['account_name'] || row['Account'] || '').trim();
    var rawAccountNumber = (row['Account Number'] || '').trim();

    // Resolve account: try account name first, then account number last-4
    var accountName = Config.resolveAccount(rawAccount);
    if (accountName === rawAccount && rawAccountNumber) {
      var last4Match = rawAccountNumber.match(/(\d{4})$/);
      if (last4Match) {
        var resolved = Config.resolveAccountFromLast4(last4Match[1]);
        if (resolved) accountName = resolved;
      }
    }

    var quantity = Utils.parseNumber(row['Quantity'] || row['quantity'] || row['qty']);
    var price = Utils.parseNumber(row['Price USD'] || row['Price'] || row['price']);
    var amount = Utils.parseNumber(row['Amount USD'] || row['Amount'] || row['amount'] || row['Net Amount']);
    var description = (row['Description'] || row['description'] || '').trim();

    return {
      date: date,
      transaction_type: normalizedType,
      raw_type: rawType,
      ticker: ticker,
      account_name: accountName,
      raw_account: rawAccount,
      quantity: quantity,
      price: price,
      amount: amount,
      description: description,
    };
  }

  /**
   * Extract account from a position CSV filename.
   * Pattern: "positions (LFRM 3515).csv" -> match last-4 digits
   */
  function extractAccountFromFilename(filename) {
    var match = filename.match(/(\d{4})/);
    if (match) {
      return Config.resolveAccountFromLast4(match[1]);
    }
    return '';
  }

  window.CSVParser = {
    parseCSV: parseCSV,
    splitCSVLine: splitCSVLine,
    normalizePositionRow: normalizePositionRow,
    normalizeTransactionRow: normalizeTransactionRow,
    extractAccountFromFilename: extractAccountFromFilename,
  };
})();
