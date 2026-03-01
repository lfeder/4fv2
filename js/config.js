/**
 * Configuration — Transaction type normalization map + account mapping.
 * Account/owner data loaded dynamically from the gsheet accounts tab.
 */
(function () {
  'use strict';

  var TRANSACTION_TYPE_MAP = {
    'BUY': 'BUY',
    'Buy': 'BUY',
    'SELL': 'SELL',
    'Sell': 'SELL',
    'Reinvestment': 'REINVEST',
    'REINVEST': 'REINVEST',
    'Dividend': 'DIVIDEND',
    'DIVIDEND': 'DIVIDEND',
    'Interest': 'INTEREST',
    'INTEREST': 'INTEREST',
    'Funds Wired': 'TRANSFER',
    'Funds Received': 'TRANSFER',
    'Transfers': 'TRANSFER',
    'TRANSFER': 'TRANSFER',
    'Banklink Manual Pull': 'TRANSFER',
    'Banklink Manual Push': 'TRANSFER',
    'Capital Call': 'CAPITAL_CALL',
    'CAPITAL_CALL': 'CAPITAL_CALL',
    'Cash Distribution': 'DISTRIBUTION',
    'DISTRIBUTION': 'DISTRIBUTION',
    'Cash in lieu': 'DISTRIBUTION',
    'Deposit Sweep - Deposit Intraday Activity': 'SWEEP',
    'Deposit Sweep - Withdrawal Intraday Activity': 'SWEEP',
    'SWEEP': 'SWEEP',
    'Misc Debit / Credit': 'ADJUSTMENT',
    'Journal': 'ADJUSTMENT',
    'Misc. Disbursement': 'ADJUSTMENT',
    'ADJUSTMENT': 'ADJUSTMENT',
    'Cost Adjustment': 'COST_ADJUSTMENT',
    'COST_ADJUSTMENT': 'COST_ADJUSTMENT',
    'Exchange': 'EXCHANGE',
    'EXCHANGE': 'EXCHANGE',
    'Fees': 'FEE',
    'FEE': 'FEE',
    'MEMO ENTRY': 'MEMO',
    'Journal': 'JOURNAL',
    'JOURNAL': 'JOURNAL',
    'MEMO': 'MEMO',
    'INITIAL_COST_BASIS': 'INITIAL_COST_BASIS',
  };

  var ACCOUNT_NAME_MAP = {};
  var ACCOUNT_LAST4_MAP = {};
  var ACCOUNT_OWNER_MAP = {};

  // Type badge colors
  var TYPE_BADGE_MAP = {
    BUY: 'badge-blue',
    SELL: 'badge-red',
    REINVEST: 'badge-blue',
    DIVIDEND: 'badge-green',
    INTEREST: 'badge-green',
    TRANSFER: 'badge-orange',
    CAPITAL_CALL: 'badge-orange',
    DISTRIBUTION: 'badge-green',
    SWEEP: 'badge-gray',
    ADJUSTMENT: 'badge-gray',
    COST_ADJUSTMENT: 'badge-gray',
    EXCHANGE: 'badge-orange',
    FEE: 'badge-red',
    JOURNAL: 'badge-orange',
    MEMO: 'badge-gray',
    INITIAL_COST_BASIS: 'badge-gray',
  };

  var CASH_FLOW_TYPES = ['TRANSFER', 'CAPITAL_CALL', 'DISTRIBUTION', 'SWEEP'];

  /**
   * Load accounts and owners from the gsheet accounts tab.
   * Populates ACCOUNT_OWNER_MAP and ACCOUNT_LAST4_MAP dynamically.
   * Call this once after SheetsAPI is initialized.
   */
  function loadAccounts() {
    return SheetsAPI.readSheet('accounts').then(function (rows) {
      rows.forEach(function (r) {
        var name = r.account_name || '';
        var owner = r.owner_name || '';
        if (!name) return;

        ACCOUNT_OWNER_MAP[name] = owner;

        // Extract last 4 digits from account name for CSV mapping
        var match = name.match(/(\d{4})\s*$/);
        if (match) {
          ACCOUNT_LAST4_MAP[match[1]] = name;
        }
      });
    }).catch(function (err) {
      console.warn('Could not load accounts from sheet:', err.message);
    });
  }

  function normalizeType(rawType) {
    if (!rawType) return 'OTHER';
    var mapped = TRANSACTION_TYPE_MAP[rawType] || TRANSACTION_TYPE_MAP[rawType.trim()];
    return mapped || rawType.toUpperCase();
  }

  function resolveAccount(rawName) {
    if (!rawName) return '';
    if (ACCOUNT_NAME_MAP[rawName]) return ACCOUNT_NAME_MAP[rawName];
    // Try last-4 digits
    var match = rawName.match(/(\d{4})\s*$/);
    if (!match) {
      match = rawName.match(/\.{3}(\d{4})/);
    }
    if (match && ACCOUNT_LAST4_MAP[match[1]]) {
      return ACCOUNT_LAST4_MAP[match[1]];
    }
    return rawName;
  }

  function resolveAccountFromLast4(last4) {
    return ACCOUNT_LAST4_MAP[last4] || '';
  }

  function getOwner(accountName) {
    return ACCOUNT_OWNER_MAP[accountName] || '';
  }

  function getTypeBadgeClass(type) {
    return TYPE_BADGE_MAP[type] || 'badge-gray';
  }

  window.Config = {
    TRANSACTION_TYPE_MAP: TRANSACTION_TYPE_MAP,
    ACCOUNT_NAME_MAP: ACCOUNT_NAME_MAP,
    ACCOUNT_LAST4_MAP: ACCOUNT_LAST4_MAP,
    ACCOUNT_OWNER_MAP: ACCOUNT_OWNER_MAP,
    TYPE_BADGE_MAP: TYPE_BADGE_MAP,
    CASH_FLOW_TYPES: CASH_FLOW_TYPES,
    loadAccounts: loadAccounts,
    normalizeType: normalizeType,
    resolveAccount: resolveAccount,
    resolveAccountFromLast4: resolveAccountFromLast4,
    getOwner: getOwner,
    getTypeBadgeClass: getTypeBadgeClass,
  };
})();
