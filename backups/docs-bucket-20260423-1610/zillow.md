## Looking Up Amplia Listings on Zillow


To check if an Amplia MLS listing appears on Zillow, use Zillow's `async-create-search-page-state` API endpoint with the MLS listing ID as a keyword filter.


### For Sale Listings
```bash
curl -s 'https://www.zillow.com/async-create-search-page-state' \
  -X 'PUT' \
  -H 'content-type: application/json' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36' \
  --data-raw '{"searchQueryState":{"pagination":{},"isMapVisible":true,"mapBounds":{"west":-68.13407255664063,"east":-65.03318144335938,"south":16.605413165154555,"north":19.780415530144108},"regionSelection":[{"regionId":48,"regionType":2}],"filterState":{"sortSelection":{"value":"days"},"isActiveStatus":{"value":false},"isComingSoonStatus":{"value":false},"isZillowPreview":{"value":false},"keywords":{"value":"LISTING_ID_HERE"}},"isListVisible":true,"mapZoom":9,"usersSearchTerm":"PR"},"wants":{"cat1":["listResults","mapResults"],"cat2":["total"],"abTrials":["total"]},"requestId":8,"isDebugRequest":false}'
```


### For Rent Listings
The key difference is adding rental filters to `filterState`:
```bash
curl -s 'https://www.zillow.com/async-create-search-page-state' \
  -X 'PUT' \
  -H 'content-type: application/json' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36' \
  --data-raw '{"searchQueryState":{"pagination":{},"isMapVisible":true,"mapBounds":{"west":-67.1450235891493,"east":-65.6673624563368,"south":16.605413165154555,"north":19.780415530144108},"regionSelection":[{"regionId":48,"regionType":2}],"filterState":{"sortSelection":{"value":"days"},"isActiveStatus":{"value":false},"isComingSoonStatus":{"value":false},"isZillowPreview":{"value":false},"keywords":{"value":"LISTING_ID_HERE"},"isForRent":{"value":true},"isForSaleByAgent":{"value":false},"isForSaleByOwner":{"value":false},"isNewConstruction":{"value":false},"isComingSoon":{"value":false},"isAuction":{"value":false},"isForSaleForeclosure":{"value":false}},"isListVisible":true,"mapZoom":9,"usersSearchTerm":"PR"},"wants":{"cat1":["listResults","mapResults"]},"requestId":15,"isDebugRequest":false}'
```


### Key Details
- **Region**: Puerto Rico is `regionId: 48`, `regionType: 2`
- **Map bounds** cover all of Puerto Rico
- The listing ID goes in `filterState.keywords.value`
- Response contains listing results in `cat1.searchResults.listResults` and `cat1.searchResults.mapResults`
- Each result has `hdpData.homeInfo.detailUrl` which can be prepended with `https://www.zillow.com` to get the full URL
- **Cookies are required** — the request needs valid Zillow session cookies (from a real browser session) to avoid empty responses. Minimal cookies may not work; the full cookie jar from a browser inspection is recommended.
- This is a simple curl request — no webscraper needed


