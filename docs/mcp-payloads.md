# NetSuite MCP payload shapes

Tested live on 2026-11-08 against account td3138390 (NetSuite Test Drive) through the standard MCP tools (`ns_*`), using the app's `/api/workbench` route.

Test records, all with memo "headless-ns payload test":

| Record | Internal id | Number | External id |
|---|---|---|---|
| Estimate | 16189 | QUO98 | hns-payload-test-est-1 |
| Sales order | 16190 | SO626 | hns-payload-test-so-1 |
| Item fulfillment | 16191 | IF465 | hns-payload-test-if-1 |

Customer 341 (124 Quinu LLP), location 2 (San Francisco), items 248 (SPC002), 243 (GAR002) and 245 (OLV002).

## Results come back inside HTTP 200

Every write tool answers HTTP 200. Check `result.success`.

- Success: `{"success": true, "recordId": "16189", "message": "..."}`. The new id is `recordId`, a string. It is not `data.id` or `id`.
- Failure: `{"success": false, "error": "HTTP 400: {...o:errorDetails[0].detail...}", "message": "..."}`. The readable reason is `o:errorDetails[].detail` inside the `error` string.
- `ns_updateRecord` success also has `"data": null`.

## A timeout can still create the record

The third fulfillment attempt took 47 s and returned `success: false` with "The host you are trying to connect to has exceeded the maximum allowed response time." About 20 s later, IF465 existed with the external id we sent.

So a failed create or transform is not proof that nothing was created. Never retry it. Set `externalId` on every create and transform, and after a timeout look the record up with `SELECT id FROM transaction WHERE externalid = '...'`.

## ns_createRecord

Worked:

```json
{
  "recordType": "estimate",
  "data": "{\"entity\":{\"id\":\"341\"},\"location\":{\"id\":\"2\"},\"externalId\":\"hns-payload-test-est-1\",\"memo\":\"headless-ns payload test\",\"item\":{\"items\":[{\"item\":{\"id\":\"248\"},\"quantity\":2,\"rate\":10},{\"item\":{\"id\":\"243\"},\"quantity\":3,\"rate\":5}]}}"
}
```

- `data` is a JSON string.
- Reference fields are `{"id": "..."}`.
- `externalId` goes inside `data`. The tool has no separate argument for it.
- Sublist lines go in `{"item": {"items": [...]}}`.

## ns_getRecord

Returns `{"success": true, "data": {...}}`.

- Reference fields read as `{"id": "341", "refName": "124 Quinu LLP"}`. Select fields such as `status` use the same shape (`{"id": "B", "refName": "Pending Fulfillment"}`).
- Sublist lines come back. `data.item.items` is an array of about 32 fields per line, including `line` (1, 2, then 5 after an update), `item` as `{id, refName}`, `quantity`, `rate`, `amount`, `isClosed` and `quantityAvailable`.
- `quantityFulfilled` is not in the sales order line. Use SuiteQL on `transactionline` for that.
- Fulfillment lines have `line` starting at 0 and an `orderLine` that points at the sales order's `line`.

## ns_transformRecord

`data` is optional and overrides the pre-filled target values. The response matches create: `{"success": true, "recordId": "16190"}`.

Estimate to sales order worked with `{"memo": "...", "externalId": "hns-payload-test-so-1"}`. The external id was saved.

Sales order to item fulfillment, shipping only line 1:

| Attempt | Data | Result |
|---|---|---|
| 1 | `shipStatus:{id:"C"}`, `item.items:[{orderLine:1,itemReceive:true,quantity:2},{orderLine:2,itemReceive:false}]` | Failed: "No UPS registration was found for the location selected." The order's `shipMethod` was 4 (UPS Ground). |
| 2 | Same plus `shipMethod:null` | Failed: "A shipping label could not be generated because the shipping method was not set." So `null` does clear a field. |
| 3 | Same plus `generateIntegratedShipperLabel:false` | Reported a timeout, but created IF465 with one line (SPC002, qty 2) and status Shipped. The order moved to "Pending Billing/Partially Fulfilled". |

Line fields on the fulfillment item sublist, from `ns_getRecordTypeMetadata`: `itemReceive`, `orderLine`, `line`, `quantity`, `quantityRemaining`, `item`, `location`. Match lines by `orderLine`. We did not try `line` as the key for transforms.

In this account, fulfillment needs `generateIntegratedShipperLabel: false`, and `shipMethod: null` when the order uses UPS.

## ns_updateRecord

The tool has only `recordType`, `recordId` and `data`. There is no sublist replace option.

- Lines without `line` are appended. `{"item":{"items":[{"item":{"id":"245"},"quantity":1,"rate":1}]}}` added line 5 and kept lines 1 and 2.
- Lines with `line` edit that line. `{"item":{"items":[{"line":5,"quantity":4}]}}` changed only line 5.
- Lines cannot be deleted. Close one instead: `{"item":{"items":[{"line":5,"isClosed":true}]}}` worked.

## ns_getRecordActionMetadata and ns_executeRecordAction

Sales order actions: `allocatesalesorder`, `approve`, `closeremaining`. Each has `parameters: {}`. `ns_executeRecordAction` takes `actionParameters` as a JSON string. Not tried live.

## ns_getRecordTransformMetadata

Returns `{"transformations": {"items": [{"source": "salesorder", "target": "invoice"}, ...]}}`. Sales order targets: cashsale, fulfillmentrequest, invoice, itemfulfillment, returnauthorization.
