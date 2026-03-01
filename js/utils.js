/**
 * Shared Utilities for Portfolio Manager v2
 */
(function () {
  'use strict';

  function formatCurrency(n) {
    if (n === null || n === undefined || isNaN(n)) return '$0';
    var abs = Math.abs(n);
    var decimals = abs < 1000 ? 2 : 0;
    var formatted = abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return (n < 0 ? '-$' : '$') + formatted;
  }

  function formatPercent(n) {
    if (n === null || n === undefined || isNaN(n)) return '0.0%';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(1) + '%';
  }

  function parseNumber(s) {
    if (s === null || s === undefined || s === '') return 0;
    var str = String(s).trim();
    if (str === '') return 0;

    var negative = false;
    if (str.charAt(0) === '(' && str.charAt(str.length - 1) === ')') {
      negative = true;
      str = str.substring(1, str.length - 1);
    }

    str = str.replace(/[$%,\s]/g, '');

    if (str.charAt(0) === '-') {
      negative = true;
      str = str.substring(1);
    }

    var num = parseFloat(str);
    if (isNaN(num)) return 0;
    return negative ? -num : num;
  }

  function generateTicker(name) {
    if (!name) return '';
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 10);
  }

  function formatDate(d) {
    var date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseDate(s) {
    if (!s) return null;
    var str = String(s).trim();

    // MM/DD/YYYY HH:MM:SS or MM/DD/YYYY
    var slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      return new Date(
        parseInt(slashMatch[3], 10),
        parseInt(slashMatch[1], 10) - 1,
        parseInt(slashMatch[2], 10)
      );
    }

    // YYYY-MM-DD
    var dashMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dashMatch) {
      return new Date(
        parseInt(dashMatch[1], 10),
        parseInt(dashMatch[2], 10) - 1,
        parseInt(dashMatch[3], 10)
      );
    }

    var fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  function formatQty(n) {
    if (n === 0) return '0';
    if (Math.abs(n) >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return n.toFixed(6);
  }

  function errMsg(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    if (err.result && err.result.error) return err.result.error.message || err.result.error.status;
    return JSON.stringify(err);
  }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function injectNav(activePage) {
    var pages = [
      { label: 'Dashboard', href: 'index.html' },
      { label: 'Uploads', href: 'uploads.html' },
      { label: 'Transactions', href: 'transactions.html' },
      { label: 'Reconciliation', href: 'reconciliation.html' },
      { label: 'Performance', href: 'performance.html' },
      { label: 'Forecaster', href: 'forecaster.html' },
      { label: 'Audit', href: 'audit.html' },
    ];

    var nav = document.getElementById('main-nav');
    if (!nav) return;

    nav.innerHTML = '';
    pages.forEach(function (page) {
      var a = document.createElement('a');
      a.href = page.href;
      a.textContent = page.label;
      if (page.label === activePage) {
        a.classList.add('active');
      }
      nav.appendChild(a);
    });
  }

  function showLoading() {
    var existing = document.getElementById('loading-overlay');
    if (existing) {
      existing.classList.remove('hidden');
      return;
    }

    var overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay';

    var spinner = document.createElement('div');
    spinner.className = 'spinner';
    overlay.appendChild(spinner);

    var text = document.createElement('div');
    text.className = 'loading-text';
    text.textContent = 'Loading...';
    overlay.appendChild(text);

    document.body.appendChild(overlay);
  }

  function hideLoading() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  function showMessage(text, type) {
    type = type || 'info';

    var msg = document.createElement('div');
    msg.className = 'flash-message flash-' + type;
    msg.textContent = text;
    msg.style.cssText =
      'position:fixed;top:70px;right:20px;z-index:10001;' +
      'padding:12px 24px;border-radius:6px;font-size:14px;' +
      'max-width:400px;box-shadow:0 4px 16px rgba(0,0,0,0.18);' +
      'cursor:pointer;color:#fff;';

    var bgMap = { success: '#2E7D32', error: '#D32F2F', info: '#2E86AB', warning: '#f57c00' };
    msg.style.background = bgMap[type] || bgMap.info;

    msg.addEventListener('click', function () {
      msg.style.opacity = '0';
      setTimeout(function () { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 300);
    });

    document.body.appendChild(msg);

    setTimeout(function () {
      if (msg.parentNode) {
        msg.style.opacity = '0';
        setTimeout(function () { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 300);
      }
    }, 5000);
  }

  /**
   * Show a modal dialog. Returns { overlay, content } for manual control.
   */
  function showModal(title, bodyHTML, buttons) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    var card = document.createElement('div');
    card.className = 'card modal-card';

    var header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = '<h2 class="card-title">' + esc(title) + '</h2>';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-sm btn-secondary';
    closeBtn.textContent = 'X';
    closeBtn.addEventListener('click', function () {
      document.body.removeChild(overlay);
    });
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = bodyHTML;

    var actions = document.createElement('div');
    actions.className = 'form-actions';
    (buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || 'btn-primary');
      btn.textContent = b.label;
      btn.addEventListener('click', function () {
        if (b.onClick) b.onClick(overlay, body);
      });
      actions.appendChild(btn);
    });

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    return { overlay: overlay, content: body };
  }

  function closeModal(overlay) {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  /**
   * Build a standard page init with sign-in flow.
   */
  function initPage(pageName, initFn) {
    document.addEventListener('DOMContentLoaded', function () {
      injectNav(pageName);
      SheetsAPI.initSheetsApi()
        .then(function () { return Config.loadAccounts(); })
        .then(function () { initFn(); });
    });
  }

  window.Utils = {
    formatCurrency: formatCurrency,
    formatPercent: formatPercent,
    parseNumber: parseNumber,
    generateTicker: generateTicker,
    formatDate: formatDate,
    parseDate: parseDate,
    formatQty: formatQty,
    errMsg: errMsg,
    esc: esc,
    injectNav: injectNav,
    showLoading: showLoading,
    hideLoading: hideLoading,
    showMessage: showMessage,
    showModal: showModal,
    closeModal: closeModal,
    initPage: initPage,
  };
})();
