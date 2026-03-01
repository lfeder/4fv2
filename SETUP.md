# Portfolio Manager v2 — Setup Guide

## Google Sheets Setup

1. Create a new Google Spreadsheet
2. Create 7 tabs with these exact names and headers:

### `owners`
| owner_name |

Populate: LFRM, JJB, Juju

### `accounts`
| account_name | owner_name |

Populate with all accounts (see config.js for the full list).

### `asset_classes`
| asset_class |

Populate: Fixed Income & Cash, Equity, Other, etc.

### `assets`
| ticker | description | asset_class |

### `marks`
| ticker | date | price |

### `transactions`
| date | transaction_type | ticker | account_name | quantity | price | amount |

### `positions`
| date | account_name | ticker | qty | price | value | cost |

## Google API Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Google Sheets API**
4. Create OAuth 2.0 credentials:
   - Application type: **Web application**
   - Authorized JavaScript origins: add your GitHub Pages URL and `http://localhost` for development
   - Authorized redirect URIs: same as origins
5. Create an API Key (restrict to Sheets API)

## Configure the App

Edit `js/sheets-api.js` and update:

```js
const SPREADSHEET_ID = 'your-spreadsheet-id-here';
const API_KEY = 'your-api-key-here';
const CLIENT_ID = 'your-client-id-here';
```

The Spreadsheet ID is in the Google Sheets URL:
`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

## Deploy

Push to the `master` branch. GitHub Pages deploys automatically via `.github/workflows/static.yml`.

## Usage

1. Open the app and click **Sign In** to authenticate with Google
2. Go to **Uploads** to import position CSVs (one per account) and the transaction CSV
3. The app will:
   - Parse CSVs and normalize data
   - Prompt to confirm new assets
   - Write to Google Sheets (assets, marks, transactions tabs)
   - Auto-derive positions from transactions
4. View the **Dashboard** for the portfolio overview
5. Use **Transactions** for manual entries (buy/sell/reinvest)
6. Use **Reconciliation** to compare derived vs CSV positions
7. Use **Performance** for TWR calculations
8. Use **Forecaster** for growth projections
