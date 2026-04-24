# Findit Important Repositories

This document lists the key GitHub repositories that power Findit (finditpr.com), along with notes on their purpose and current status.

## Core Application

- **API backend:** https://github.com/jginorio/api.finditpr.com
- **Web frontend (Angular, being deprecated):** https://github.com/jginorio/finditpr.com — currently being deprecated in favor of the Next.js version below.
- **Web frontend (Next.js):** https://github.com/jginorio/finditpr.com-nextjs

## Lambdas and Services

- **Notifications dispatcher (Lambda):** https://github.com/jginorio/notifications-dispatcher-lambda
- **Search API (Lambda):** https://github.com/jginorio/search-api — handles the autocomplete suggestions on Findit.
- **Data pipeline (Lambda):** https://github.com/jginorio/finditpr.com-data-pipeline — responsible for getting Amplia MLS data into finditpr.com. The Stellar integration is currently shut down in this repo, but once it is turned back on we can gracefully deprecate the standalone Stellar repo (https://github.com/jginorio/stellar) and keep everything under `finditpr.com-data-pipeline`, since Stellar MLS data is ingested basically the same way as Amplia MLS data.
