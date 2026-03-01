/**
 * Uploads Page — CSV upload orchestration.
 * 3 tabs: Transactions, Marks, Initial Load.
 */
(function () {
  'use strict';

  var currentMode = 'transactions';
  var pendingMarksData = null;
  var pendingInitialData = null;
  var pendingTransactionData = null;

  function initUploads() {
    setupTabs();
    setupTransactionUpload();
    setupMarksUpload();
    setupInitialUpload();
  }

  // --- Tab switching ---
  function setupTabs() {
    var tabs = document.querySelectorAll('.upload-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        currentMode = tab.getAttribute('data-mode');
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');

        document.getElementById('transactions-section').classList.toggle('hidden', currentMode !== 'transactions');
        document.getElementById('marks-section').classList.toggle('hidden', currentMode !== 'marks');
        document.getElementById('initial-section').classList.toggle('hidden', currentMode !== 'initial');
        hideAllPreviews();
      });
    });
  }

  function hideAllPreviews() {
    ['status-area', 'preview-area', 'warnings-area', 'account-mapping-area', 'type-mapping-area', 'confirm-area', 'summary-area'].forEach(function (id) {
      document.getElementById(id).classList.add('hidden');
    });
  }

  // =====================================================================
  // TRANSACTION CSV UPLOAD
  // =====================================================================
  function setupTransactionUpload() {
    var fileInput = document.getElementById('transaction-file');
    var processBtn = document.getElementById('process-transactions-btn');

    fileInput.addEventListener('change', function () {
      processBtn.disabled = !fileInput.files.length;
      hideAllPreviews();
    });

    processBtn.addEventListener('click', function () {
      var file = fileInput.files[0];
      if (!file) return;

      hideAllPreviews();
      setStatus('Parsing transactions...', 'info');

      readFileText(file).then(function (text) {
        var parsed = CSVParser.parseCSV(text);
        var rows = parsed.rows.map(CSVParser.normalizeTransactionRow).filter(function (r) {
          return r.date;
        });

        if (rows.length === 0) {
          setStatus('No valid transaction rows found.', 'error');
          return;
        }

        pendingTransactionData = { rows: rows, accountOverrides: {}, typeOverrides: {} };

        setStatus('Parsed ' + rows.length + ' transactions. Review mappings and confirm.', 'info');
        showAccountMapping(rows);
        showTypeMapping(rows);
        showTransactionPreview(rows);
        document.getElementById('confirm-area').classList.remove('hidden');

        var confirmBtn = document.getElementById('confirm-import-btn');
        var cancelBtn = document.getElementById('cancel-import-btn');
        confirmBtn.onclick = function () { confirmTransactionImport(); };
        cancelBtn.onclick = function () { hideAllPreviews(); pendingTransactionData = null; };
      });
    });
  }

  function showAccountMapping(rows) {
    var area = document.getElementById('account-mapping-area');
    var body = document.getElementById('account-mapping-body');
    area.classList.remove('hidden');

    var rawAccounts = {};
    rows.forEach(function (r) {
      if (r.raw_account && !rawAccounts[r.raw_account]) {
        rawAccounts[r.raw_account] = r.account_name;
      }
    });

    var allAccounts = Object.values(Config.ACCOUNT_LAST4_MAP);

    body.innerHTML = Object.keys(rawAccounts).map(function (raw) {
      var mapped = rawAccounts[raw];
      var options = allAccounts.map(function (a) {
        return '<option value="' + Utils.esc(a) + '"' + (a === mapped ? ' selected' : '') + '>' + Utils.esc(a) + '</option>';
      }).join('');
      return '<tr>' +
        '<td>' + Utils.esc(raw) + '</td>' +
        '<td><select class="acct-override" data-raw="' + Utils.esc(raw) + '">' + options + '</select></td>' +
        '</tr>';
    }).join('');

    body.querySelectorAll('.acct-override').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var raw = sel.getAttribute('data-raw');
        pendingTransactionData.accountOverrides[raw] = sel.value;
      });
    });
  }

  function showTypeMapping(rows) {
    var area = document.getElementById('type-mapping-area');
    var body = document.getElementById('type-mapping-body');
    area.classList.remove('hidden');

    var typeCounts = {};
    rows.forEach(function (r) {
      var key = r.raw_type || 'UNKNOWN';
      if (!typeCounts[key]) typeCounts[key] = { count: 0, normalized: r.transaction_type };
      typeCounts[key].count++;
    });

    var allTypes = ['BUY', 'SELL', 'REINVEST', 'DIVIDEND', 'INTEREST', 'TRANSFER',
      'CAPITAL_CALL', 'DISTRIBUTION', 'SWEEP', 'ADJUSTMENT', 'COST_ADJUSTMENT',
      'EXCHANGE', 'FEE', 'MEMO', 'OTHER'];

    body.innerHTML = Object.keys(typeCounts).sort().map(function (raw) {
      var info = typeCounts[raw];
      var options = allTypes.map(function (t) {
        return '<option value="' + t + '"' + (t === info.normalized ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
      return '<tr>' +
        '<td>' + Utils.esc(raw) + '</td>' +
        '<td class="text-right">' + info.count + '</td>' +
        '<td><select class="type-override" data-raw="' + Utils.esc(raw) + '">' + options + '</select></td>' +
        '</tr>';
    }).join('');

    body.querySelectorAll('.type-override').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var raw = sel.getAttribute('data-raw');
        pendingTransactionData.typeOverrides[raw] = sel.value;
      });
    });
  }

  function showTransactionPreview(rows) {
    var area = document.getElementById('preview-area');
    var head = document.getElementById('preview-head');
    var body = document.getElementById('preview-body');
    var count = document.getElementById('preview-count');

    area.classList.remove('hidden');
    count.textContent = rows.length;

    var headers = ['Date', 'Type', 'Ticker', 'Account', 'Qty', 'Price', 'Amount'];
    var colKeys = ['date', 'transaction_type', 'ticker', 'account_name', 'quantity', 'price', 'amount'];
    head.innerHTML = '<tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>';

    function renderTxnRow(r) {
      var badgeCls = Config.getTypeBadgeClass(r.transaction_type);
      return '<tr>' +
        '<td>' + Utils.esc(r.date) + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + Utils.esc(r.transaction_type) + '</span></td>' +
        '<td>' + Utils.esc(r.ticker) + '</td>' +
        '<td>' + Utils.esc(r.account_name) + '</td>' +
        '<td class="text-right">' + Utils.formatQty(r.quantity) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(r.price) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(r.amount) + '</td>' +
        '</tr>';
    }

    body.innerHTML = rows.map(renderTxnRow).join('');
    makeSortable('preview-head', 'preview-body', rows, renderTxnRow, colKeys);
  }

  function confirmTransactionImport() {
    if (!pendingTransactionData) return;

    Utils.showLoading();
    document.getElementById('confirm-area').classList.add('hidden');
    setStatus('Importing transactions...', 'info');

    var rows = pendingTransactionData.rows;
    var acctOverrides = pendingTransactionData.accountOverrides;
    var typeOverrides = pendingTransactionData.typeOverrides;

    rows.forEach(function (r) {
      if (acctOverrides[r.raw_account]) {
        r.account_name = acctOverrides[r.raw_account];
      }
      if (typeOverrides[r.raw_type]) {
        r.transaction_type = typeOverrides[r.raw_type];
      }
    });

    SheetsAPI.readSheet('assets').then(function (existingAssets) {
      var existingTickers = {};
      existingAssets.forEach(function (a) {
        existingTickers[(a.ticker || '').toUpperCase()] = true;
      });

      var newTickers = {};
      rows.forEach(function (r) {
        if (r.ticker) {
          var upper = r.ticker.toUpperCase();
          if (!existingTickers[upper] && !newTickers[upper]) {
            newTickers[upper] = { ticker: r.ticker, description: '', asset_class: '' };
          }
        }
      });

      var newAssetList = Object.values(newTickers);
      Utils.hideLoading();

      if (newAssetList.length > 0) {
        confirmNewAssets(newAssetList, 0, function (confirmedAssets) {
          writeTransactionData(rows, confirmedAssets);
        });
      } else {
        writeTransactionData(rows, []);
      }
    }).catch(function (err) {
      Utils.hideLoading();
      setStatus('Error: ' + err.message, 'error');
    });
  }

  function writeTransactionData(rows, newAssets) {
    Utils.showLoading();

    var assetRows = newAssets.map(function (a) {
      return [a.ticker, a.description, a.asset_class];
    });
    var assetPromise = assetRows.length > 0
      ? SheetsAPI.appendRows('assets', assetRows)
      : Promise.resolve();

    assetPromise.then(function () {
      var txnRows = rows.map(function (r) {
        return [r.date, r.transaction_type, r.ticker, r.account_name, r.quantity, r.price, r.amount];
      });
      return SheetsAPI.appendRows('transactions', txnRows);
    }).then(function () {
      return PositionEngine.recalculatePositions();
    }).then(function (positions) {
      Utils.hideLoading();

      var summary =
        '<p><strong>New assets added:</strong> ' + newAssets.length + '</p>' +
        '<p><strong>Transactions imported:</strong> ' + rows.length + '</p>' +
        '<p><strong>Positions recalculated:</strong> ' + positions.length + '</p>';

      document.getElementById('summary-area').classList.remove('hidden');
      document.getElementById('summary-content').innerHTML = summary;
      setStatus('Transaction import complete!', 'success');
      Utils.showMessage('Transaction import complete', 'success');
    }).catch(function (err) {
      Utils.hideLoading();
      setStatus('Error: ' + err.message, 'error');
      Utils.showMessage('Import failed: ' + err.message, 'error');
    });
  }

  // =====================================================================
  // MARKS CSV UPLOAD
  // =====================================================================
  function setupMarksUpload() {
    var fileInput = document.getElementById('marks-files');
    var processBtn = document.getElementById('process-marks-btn');

    fileInput.addEventListener('change', function () {
      processBtn.disabled = !fileInput.files.length;
      hideAllPreviews();
    });

    processBtn.addEventListener('click', function () {
      var files = Array.from(fileInput.files);
      if (files.length === 0) return;

      hideAllPreviews();
      setStatus('Parsing ' + files.length + ' file(s) for marks...', 'info');

      var filePromises = files.map(function (file) {
        return readFileText(file).then(function (text) {
          var parsed = CSVParser.parseCSV(text);
          var rows = parsed.rows
            .map(CSVParser.normalizePositionRow)
            .filter(function (r) { return r.ticker; });
          return { filename: file.name, rows: rows };
        });
      });

      Promise.all(filePromises).then(function (fileResults) {
        // Extract marks: date, ticker, price
        var markRows = [];
        fileResults.forEach(function (f) {
          f.rows.forEach(function (r) {
            if (r.ticker && r.price) {
              markRows.push({
                date: r.date || '',
                ticker: r.ticker,
                price: Utils.parseNumber(r.price),
              });
            }
          });
        });

        if (markRows.length === 0) {
          setStatus('No valid mark rows found.', 'error');
          return;
        }

        pendingMarksData = { marks: markRows };
        setStatus('Parsed ' + markRows.length + ' marks. Review and confirm.', 'info');
        showMarksPreview(markRows);

        // Check for warnings
        checkMarksWarnings(markRows);

        document.getElementById('confirm-area').classList.remove('hidden');
        var confirmBtn = document.getElementById('confirm-import-btn');
        var cancelBtn = document.getElementById('cancel-import-btn');
        confirmBtn.onclick = function () { confirmMarksImport(); };
        cancelBtn.onclick = function () { hideAllPreviews(); pendingMarksData = null; };
      });
    });
  }

  function showMarksPreview(markRows) {
    var area = document.getElementById('preview-area');
    var head = document.getElementById('preview-head');
    var body = document.getElementById('preview-body');
    var count = document.getElementById('preview-count');

    area.classList.remove('hidden');
    count.textContent = markRows.length;

    var headers = ['Date', 'Ticker', 'Price'];
    var colKeys = ['date', 'ticker', 'price'];
    head.innerHTML = '<tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>';

    function renderMarkRow(r) {
      return '<tr>' +
        '<td>' + Utils.esc(r.date) + '</td>' +
        '<td>' + Utils.esc(r.ticker) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(r.price) + '</td>' +
        '</tr>';
    }

    body.innerHTML = markRows.map(renderMarkRow).join('');
    makeSortable('preview-head', 'preview-body', markRows, renderMarkRow, colKeys);
  }

  function checkMarksWarnings(markRows) {
    // Check for: 1) JPM assets with qty but no marks, 2) marks for unknown tickers
    Promise.all([
      SheetsAPI.readSheet('assets'),
      SheetsAPI.readSheet('transactions'),
    ]).then(function (results) {
      var assets = results[0];
      var transactions = results[1];
      var warnings = [];

      // Tickers in marks upload
      var markTickers = {};
      markRows.forEach(function (m) {
        markTickers[m.ticker.toUpperCase()] = true;
      });

      // Known asset tickers
      var assetTickers = {};
      assets.forEach(function (a) {
        assetTickers[(a.ticker || '').toUpperCase()] = true;
      });

      // Find tickers with qty (from transactions) but no marks in this upload
      var txnTickers = {};
      transactions.forEach(function (t) {
        var type = (t.transaction_type || '').toUpperCase();
        if (type === 'BUY' || type === 'REINVEST' || type === 'INITIAL_COST_BASIS') {
          var ticker = (t.ticker || '').toUpperCase();
          if (ticker) txnTickers[ticker] = true;
        }
      });

      Object.keys(txnTickers).forEach(function (ticker) {
        if (!markTickers[ticker]) {
          warnings.push('Asset <strong>' + Utils.esc(ticker) + '</strong> has transactions but no mark in this upload.');
        }
      });

      // Find tickers in marks not in asset table
      Object.keys(markTickers).forEach(function (ticker) {
        if (!assetTickers[ticker]) {
          warnings.push('Ticker <strong>' + Utils.esc(ticker) + '</strong> in marks is not in the assets table.');
        }
      });

      if (warnings.length > 0) {
        var warnArea = document.getElementById('warnings-area');
        var warnContent = document.getElementById('warnings-content');
        warnArea.classList.remove('hidden');
        warnContent.innerHTML = '<ul class="text-sm" style="color:#e65100">' +
          warnings.map(function (w) { return '<li>' + w + '</li>'; }).join('') +
          '</ul>';
      }
    });
  }

  function confirmMarksImport() {
    if (!pendingMarksData) return;

    Utils.showLoading();
    document.getElementById('confirm-area').classList.add('hidden');
    setStatus('Importing marks...', 'info');

    var marks = pendingMarksData.marks;
    var markRows = marks.map(function (m) {
      return [m.ticker, m.date, m.price];
    });

    SheetsAPI.upsertRows('marks', markRows, 0, 1).then(function (result) {
      Utils.hideLoading();

      var summary =
        '<p><strong>Marks added:</strong> ' + result.added + '</p>' +
        '<p><strong>Marks skipped (existing):</strong> ' + result.skipped + '</p>';

      document.getElementById('summary-area').classList.remove('hidden');
      document.getElementById('summary-content').innerHTML = summary;
      setStatus('Marks import complete!', 'success');
      Utils.showMessage('Marks import complete', 'success');
    }).catch(function (err) {
      Utils.hideLoading();
      setStatus('Error: ' + err.message, 'error');
    });
  }

  // =====================================================================
  // INITIAL LOAD (POSITION CSVs -> INITIAL_COST_BASIS)
  // =====================================================================
  function setupInitialUpload() {
    var fileInput = document.getElementById('initial-files');
    var processBtn = document.getElementById('process-initial-btn');

    fileInput.addEventListener('change', function () {
      processBtn.disabled = !fileInput.files.length;
      hideAllPreviews();
    });

    processBtn.addEventListener('click', function () {
      var files = Array.from(fileInput.files);
      if (files.length === 0) return;

      hideAllPreviews();
      setStatus('Parsing ' + files.length + ' file(s)...', 'info');

      var filePromises = files.map(function (file) {
        return readFileText(file).then(function (text) {
          var account = CSVParser.extractAccountFromFilename(file.name);
          var parsed = CSVParser.parseCSV(text);
          var rows = parsed.rows
            .map(CSVParser.normalizePositionRow)
            .filter(function (r) { return r.ticker && (r.quantity !== 0 || r.value !== 0); });
          return { filename: file.name, account: account, rows: rows };
        });
      });

      Promise.all(filePromises).then(function (fileResults) {
        var totalRows = 0;
        fileResults.forEach(function (f) { totalRows += f.rows.length; });

        if (totalRows === 0) {
          setStatus('No valid position rows found.', 'error');
          return;
        }

        pendingInitialData = { files: fileResults };
        setStatus('Parsed ' + totalRows + ' positions from ' + fileResults.length + ' file(s). Review and confirm.', 'info');
        showInitialPreview(fileResults);
        document.getElementById('confirm-area').classList.remove('hidden');

        var confirmBtn = document.getElementById('confirm-import-btn');
        var cancelBtn = document.getElementById('cancel-import-btn');
        confirmBtn.onclick = function () { confirmInitialImport(); };
        cancelBtn.onclick = function () { hideAllPreviews(); pendingInitialData = null; };
      });
    });
  }

  function showInitialPreview(fileResults) {
    var area = document.getElementById('preview-area');
    var head = document.getElementById('preview-head');
    var body = document.getElementById('preview-body');
    var count = document.getElementById('preview-count');

    area.classList.remove('hidden');

    var headers = ['File', 'Account', 'Ticker', 'Description', 'Asset Class', 'Qty', 'Price', 'Cost'];
    var colKeys = ['file', 'account', 'ticker', 'description', 'asset_class', 'quantity', 'price', 'cost'];
    head.innerHTML = '<tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>';

    var flatRows = [];
    fileResults.forEach(function (f) {
      f.rows.forEach(function (r) {
        flatRows.push({
          file: f.filename, account: f.account,
          ticker: r.ticker, description: r.description, asset_class: r.asset_class,
          quantity: r.quantity, price: r.price, cost: r.cost,
        });
      });
    });

    count.textContent = flatRows.length;

    function renderRow(r) {
      return '<tr>' +
        '<td>' + Utils.esc(r.file) + '</td>' +
        '<td>' + Utils.esc(r.account) + '</td>' +
        '<td>' + Utils.esc(r.ticker) + '</td>' +
        '<td>' + Utils.esc(r.description) + '</td>' +
        '<td>' + Utils.esc(r.asset_class) + '</td>' +
        '<td class="text-right">' + Utils.formatQty(r.quantity) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(r.price) + '</td>' +
        '<td class="text-right">' + Utils.formatCurrency(r.cost) + '</td>' +
        '</tr>';
    }

    body.innerHTML = flatRows.map(renderRow).join('');
    makeSortable('preview-head', 'preview-body', flatRows, renderRow, colKeys);
  }

  function confirmInitialImport() {
    if (!pendingInitialData) return;

    Utils.showLoading();
    document.getElementById('confirm-area').classList.add('hidden');

    var files = pendingInitialData.files;

    SheetsAPI.readSheet('assets').then(function (existingAssets) {
      var existingTickers = {};
      existingAssets.forEach(function (a) {
        existingTickers[(a.ticker || '').toUpperCase()] = true;
      });

      var newAssets = {};
      var allPositionRows = [];

      files.forEach(function (f) {
        f.rows.forEach(function (r) {
          allPositionRows.push({ account: f.account, row: r });
          var tickerUpper = r.ticker.toUpperCase();
          if (!existingTickers[tickerUpper] && !newAssets[tickerUpper]) {
            newAssets[tickerUpper] = {
              ticker: r.ticker,
              description: r.description,
              asset_class: r.asset_class,
            };
          }
        });
      });

      var newAssetList = Object.values(newAssets);
      Utils.hideLoading();

      if (newAssetList.length > 0) {
        confirmNewAssets(newAssetList, 0, function (confirmedAssets) {
          writeInitialData(allPositionRows, confirmedAssets);
        });
      } else {
        writeInitialData(allPositionRows, []);
      }
    }).catch(function (err) {
      Utils.hideLoading();
      setStatus('Error reading existing assets: ' + err.message, 'error');
    });
  }

  function writeInitialData(allPositionRows, newAssets) {
    Utils.showLoading();
    setStatus('Writing data to Google Sheets...', 'info');

    var assetRows = newAssets.map(function (a) {
      return [a.ticker, a.description, a.asset_class];
    });

    var assetPromise = assetRows.length > 0
      ? SheetsAPI.appendRows('assets', assetRows)
      : Promise.resolve();

    assetPromise.then(function () {
      var markRows = [];
      var txnRows = [];

      allPositionRows.forEach(function (item) {
        var r = item.row;
        var account = item.account;
        markRows.push([r.ticker, r.date, r.price]);
        txnRows.push([r.date, 'INITIAL_COST_BASIS', r.ticker, account, r.quantity, r.price, r.cost]);
      });

      return SheetsAPI.upsertRows('marks', markRows, 0, 1).then(function (markResult) {
        return SheetsAPI.appendRows('transactions', txnRows).then(function () {
          return markResult;
        });
      });
    }).then(function (markResult) {
      return PositionEngine.recalculatePositions().then(function (positions) {
        Utils.hideLoading();

        var summary =
          '<p><strong>New assets added:</strong> ' + newAssets.length + '</p>' +
          '<p><strong>Marks written:</strong> ' + (markResult ? markResult.added : 0) + ' new, ' + (markResult ? markResult.skipped : 0) + ' existing</p>' +
          '<p><strong>Transactions created:</strong> ' + allPositionRows.length + ' (INITIAL_COST_BASIS)</p>' +
          '<p><strong>Positions recalculated:</strong> ' + positions.length + '</p>';

        document.getElementById('summary-area').classList.remove('hidden');
        document.getElementById('summary-content').innerHTML = summary;
        setStatus('Initial load complete!', 'success');
        Utils.showMessage('Initial load complete', 'success');
      });
    }).catch(function (err) {
      Utils.hideLoading();
      setStatus('Error during import: ' + err.message, 'error');
      Utils.showMessage('Import failed: ' + err.message, 'error');
    });
  }

  // =====================================================================
  // SHARED: NEW ASSET CONFIRMATION
  // =====================================================================
  function confirmNewAssets(assetList, index, onDone) {
    if (index >= assetList.length) {
      var confirmed = assetList.filter(function (a) { return !a._skipped; });
      onDone(confirmed);
      return;
    }

    var asset = assetList[index];
    var bodyHTML =
      '<div class="form-row">' +
        '<div class="form-group"><label>Ticker</label><input type="text" id="modal-ticker" value="' + Utils.esc(asset.ticker) + '"></div>' +
        '<div class="form-group"><label>Description</label><input type="text" id="modal-desc" value="' + Utils.esc(asset.description) + '"></div>' +
      '</div>' +
      '<div class="form-group"><label>Asset Class</label><input type="text" id="modal-class" value="' + Utils.esc(asset.asset_class) + '"></div>' +
      '<p class="text-sm text-muted mt-1">Asset ' + (index + 1) + ' of ' + assetList.length + '</p>';

    Utils.showModal('New Asset: ' + asset.ticker, bodyHTML, [
      {
        label: 'Confirm',
        cls: 'btn-success',
        onClick: function (overlay, body) {
          asset.ticker = body.querySelector('#modal-ticker').value.trim();
          asset.description = body.querySelector('#modal-desc').value.trim();
          asset.asset_class = body.querySelector('#modal-class').value.trim();
          Utils.closeModal(overlay);
          confirmNewAssets(assetList, index + 1, onDone);
        },
      },
      {
        label: 'Skip',
        cls: 'btn-secondary',
        onClick: function (overlay) {
          asset._skipped = true;
          Utils.closeModal(overlay);
          confirmNewAssets(assetList, index + 1, onDone);
        },
      },
    ]);
  }

  // =====================================================================
  // SORTABLE TABLES
  // =====================================================================
  function makeSortable(headId, bodyId, data, renderRowFn, colKeys) {
    var thead = document.getElementById(headId);
    var tbody = document.getElementById(bodyId);
    var sortState = { col: null, asc: true };

    var ths = thead.querySelectorAll('th');
    ths.forEach(function (th, idx) {
      if (idx >= colKeys.length) return;
      th.style.cursor = 'pointer';
      th.classList.add('sortable');
      th.addEventListener('click', function () {
        var key = colKeys[idx];
        if (sortState.col === key) {
          sortState.asc = !sortState.asc;
        } else {
          sortState.col = key;
          sortState.asc = true;
        }

        data.sort(function (a, b) {
          var va = a[key], vb = b[key];
          if (va === undefined) va = '';
          if (vb === undefined) vb = '';
          if (typeof va === 'string') va = va.toLowerCase();
          if (typeof vb === 'string') vb = vb.toLowerCase();
          if (va < vb) return sortState.asc ? -1 : 1;
          if (va > vb) return sortState.asc ? 1 : -1;
          return 0;
        });

        tbody.innerHTML = data.map(renderRowFn).join('');
      });
    });
  }

  // =====================================================================
  // HELPERS
  // =====================================================================
  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(new Error('Failed to read file: ' + file.name)); };
      reader.readAsText(file);
    });
  }

  function setStatus(message, type) {
    var area = document.getElementById('status-area');
    var msg = document.getElementById('status-message');
    area.classList.remove('hidden');
    msg.className = 'alert alert-' + (type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
    msg.textContent = message;
  }

  window.initUploads = initUploads;
})();
