/**
 * Google Sheets API Data Layer
 * Uses gapi client library and Google Identity Services for OAuth2.
 */
(function () {
  'use strict';

  const SPREADSHEET_ID = '1ucJ7U75CeOmMTOIOfPwF3gNrgyBMQPhTuD47fgz3xxM';
  const API_KEY = 'AIzaSyDwG_knUVVm2USXwDHgLdREmKikWfCCnDU';
  const CLIENT_ID = '506364476970-152i9hnn856217op0n7r6sf93lk5omt9.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
  const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

  let tokenClient = null;
  let gapiInitialized = false;
  let accessToken = null;

  function initSheetsApi() {
    return new Promise(function (resolve, reject) {
      if (typeof gapi === 'undefined') {
        reject(new Error('gapi not loaded. Include the Google API client script in your HTML.'));
        return;
      }
      gapi.load('client', function () {
        gapi.client
          .init({
            apiKey: API_KEY,
            discoveryDocs: [DISCOVERY_DOC],
          })
          .then(function () {
            gapiInitialized = true;
            if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
              tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: function () {},
              });
            }
            // Try silent sign-in first (no popup), fall back to consent prompt
            return signIn(true).catch(function () {
              return signIn(false);
            });
          })
          .then(function () {
            resolve();
          })
          .catch(function (err) {
            reject(err);
          });
      });
    });
  }

  function signIn(silent) {
    return new Promise(function (resolve, reject) {
      if (!tokenClient) {
        reject(new Error('Token client not initialized.'));
        return;
      }
      tokenClient.callback = function (response) {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        accessToken = response.access_token;
        resolve(accessToken);
      };
      tokenClient.error_callback = function (err) {
        reject(err);
      };
      // prompt: '' = silent/no popup; prompt: 'consent' = full popup
      tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
    });
  }

  function isSignedIn() {
    return accessToken !== null;
  }

  function colToLetter(col) {
    var letter = '';
    while (col > 0) {
      var mod = (col - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      col = Math.floor((col - 1) / 26);
    }
    return letter;
  }

  function readSheet(tabName) {
    return gapi.client.sheets.spreadsheets.values
      .get({
        spreadsheetId: SPREADSHEET_ID,
        range: tabName,
      })
      .then(function (response) {
        var values = response.result.values;
        if (!values || values.length === 0) {
          return [];
        }
        var headers = values[0];
        var rows = [];
        for (var i = 1; i < values.length; i++) {
          var obj = {};
          for (var j = 0; j < headers.length; j++) {
            obj[headers[j]] = values[i][j] !== undefined ? values[i][j] : '';
          }
          rows.push(obj);
        }
        return rows;
      });
  }

  function readSheetRaw(tabName) {
    return gapi.client.sheets.spreadsheets.values
      .get({
        spreadsheetId: SPREADSHEET_ID,
        range: tabName,
      })
      .then(function (response) {
        return response.result.values || [];
      });
  }

  function appendRows(tabName, rows) {
    return gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: tabName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: rows,
      },
    });
  }

  function updateCell(tabName, row, col, value) {
    var cellRef = tabName + '!' + colToLetter(col) + row;
    return gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: cellRef,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[value]],
      },
    });
  }

  function batchUpdate(tabName, updates) {
    var data = updates.map(function (u) {
      return {
        range: tabName + '!' + colToLetter(u.col) + u.row,
        values: [[u.value]],
      };
    });
    return gapi.client.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: data,
      },
    });
  }

  function clearAndWriteSheet(tabName, data) {
    return gapi.client.sheets.spreadsheets.values
      .clear({
        spreadsheetId: SPREADSHEET_ID,
        range: tabName,
      })
      .then(function () {
        return gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: tabName + '!A1',
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: data,
          },
        });
      });
  }

  function getOrCreateSheet(tabName) {
    return gapi.client.sheets.spreadsheets
      .get({
        spreadsheetId: SPREADSHEET_ID,
      })
      .then(function (response) {
        var sheets = response.result.sheets || [];
        var exists = sheets.some(function (s) {
          return s.properties.title === tabName;
        });
        if (exists) {
          return;
        }
        return gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: tabName,
                  },
                },
              },
            ],
          },
        });
      });
  }

  /**
   * Upsert rows into a tab. For each row, check if a matching key already exists.
   * If it does, skip (or update); if not, append.
   * @param {string} tabName
   * @param {Array<Array>} newRows - rows to upsert (without header)
   * @param {number} keyColIndex - column index (0-based) to use as the unique key
   * @param {number} [secondKeyColIndex] - optional second key column for composite keys
   * @returns {Promise<{added: number, skipped: number}>}
   */
  function upsertRows(tabName, newRows, keyColIndex, secondKeyColIndex) {
    return readSheetRaw(tabName).then(function (existing) {
      var existingKeys = {};
      for (var i = 1; i < existing.length; i++) {
        var key = (existing[i][keyColIndex] || '');
        if (secondKeyColIndex !== undefined) {
          key += '|' + (existing[i][secondKeyColIndex] || '');
        }
        existingKeys[key] = true;
      }

      var toAdd = [];
      var skipped = 0;
      newRows.forEach(function (row) {
        var key = (row[keyColIndex] || '');
        if (secondKeyColIndex !== undefined) {
          key += '|' + (row[secondKeyColIndex] || '');
        }
        if (existingKeys[key]) {
          skipped++;
        } else {
          toAdd.push(row);
          existingKeys[key] = true;
        }
      });

      if (toAdd.length === 0) {
        return { added: 0, skipped: skipped };
      }

      return appendRows(tabName, toAdd).then(function () {
        return { added: toAdd.length, skipped: skipped };
      });
    });
  }

  /**
   * Ensure all required tabs exist with their headers.
   */
  function ensureAllTabs() {
    var tabs = {
      owners: ['owner_name'],
      accounts: ['account_name', 'owner_name'],
      asset_classes: ['asset_class'],
      assets: ['ticker', 'asset_name', 'asset_class'],
      marks: ['ticker', 'date', 'price'],
      transactions: ['date', 'transaction_type', 'ticker', 'account_name', 'quantity', 'price', 'amount'],
      positions: ['date', 'account_name', 'ticker', 'qty', 'price', 'value', 'cost'],
    };

    var tabNames = Object.keys(tabs);
    return tabNames.reduce(function (chain, tabName) {
      return chain.then(function () {
        return getOrCreateSheet(tabName).then(function () {
          return readSheetRaw(tabName).then(function (data) {
            if (!data || data.length === 0) {
              return appendRows(tabName, [tabs[tabName]]);
            }
          });
        });
      });
    }, Promise.resolve());
  }

  window.SheetsAPI = {
    SPREADSHEET_ID: SPREADSHEET_ID,
    initSheetsApi: initSheetsApi,
    signIn: signIn,
    isSignedIn: isSignedIn,
    readSheet: readSheet,
    readSheetRaw: readSheetRaw,
    appendRows: appendRows,
    updateCell: updateCell,
    batchUpdate: batchUpdate,
    clearAndWriteSheet: clearAndWriteSheet,
    getOrCreateSheet: getOrCreateSheet,
    upsertRows: upsertRows,
    ensureAllTabs: ensureAllTabs,
  };
})();
