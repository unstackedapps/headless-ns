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

## Records UI demo

Made through the Records screen on 2026-11-08, memo "headless-ns Records UI demo":

| Record | Internal id | Number | Result |
|---|---|---|---|
| Estimate | 16192 | QUO99 | Two lines, now Processed |
| Sales order | 16290 | SO627 | Partially fulfilled: SPC002 shipped 2, GAR002 open 0 of 3 |
| Item fulfillment | 16193 | IF466 | Line 1 only, Shipped, ship method left empty |

Each has an `hns-<type>-<uuid>` external id set by the server.

## Order to cash (Phase 2)

Run on 2026-11-08 through the transaction page routes (`/api/flow`, `/api/records`, `/api/records/transform`). Memo "headless-ns workflow test", external ids `hns-wf-*`.

| Record | Internal id | Number | External id | Result |
|---|---|---|---|---|
| Estimate | 16194 | QUO100 | hns-wf-estimate-o2c-1 | Processed |
| Sales order | 16291 | SO628 | hns-wf-salesorder-o2c-1 | Billed |
| Item fulfillment | 16292 | | hns-wf-itemfulfillment-o2c-1 | Made as Picked, then set to Shipped |
| Invoice | 16195 | INV434 | hns-wf-invoice-o2c-1 | Paid In Full |
| Customer payment | 16196 | PYMT398 | hns-wf-customerpayment-o2c-1 | 5.00, account 122 |
| Customer payment | 16197 | PYMT399 | hns-wf-customerpayment-o2c-2 | 15.00, no account |

### Status codes

Read the status letter from SuiteQL (`transaction.status`), not from the record. `BUILTIN.DF(status)` reads like "Sales Order : Pending Billing".

| Type | Codes seen or used |
|---|---|
| Estimate | A Open, B Processed, X Expired |
| SalesOrd | A Pending Approval, B Pending Fulfillment, D Partially Fulfilled, E Pending Billing/Partially Fulfilled, F Pending Billing, G Billed, H Closed |
| CustInvc | A Open, B Paid In Full |
| ItemShip | A Picked, B Packed, C Shipped |
| CustPymt | C Deposited |

### Line quantities

`transactionline.id` equals the record's `line`. Sales order quantities are negative there, so use the absolute value. `quantityshiprecv` is the fulfilled (or received) quantity, `quantitybilled` the billed one. The order's shipping charge is also a line (item "UPS® Ground"), and tax is a line with `taxline = 'T'`. The page shows only the lines in the record's `item` sublist.

### Steps that worked

- Fulfillment status update: `ns_updateRecord` with `{"shipStatus":{"id":"C"}}` moved IF from Picked to Shipped.
- Sales order to invoice: transform with only `memo` and `externalId`. It billed the fulfilled quantity.
- Invoice to customer payment: transform with `{"payment":5,"tranDate":"2026-11-08","account":{"id":"122"}}`. A payment below the open amount applies that amount to the invoice and leaves it Open. No `apply` lines or `undepFunds` were needed. Without `account`, NetSuite used its default and the payment also read Deposited.
- `NextTransactionLineLink` joined to `transaction` lists what a record was made from and turned into.

## Procure to pay (Phase 2)

Run on 2026-11-08 through the same routes. Vendor 628 (Core4Solutions), item 541 (KAP001), location 2.

| Record | Internal id | Number | External id | Result |
|---|---|---|---|---|
| Purchase order | 16198 | PO446 | hns-wf-purchaseorder-p2p-1 | 4 ordered, 3 received, line closed, Closed |
| Item receipt | 16199 | IR439 | hns-wf-itemreceipt-p2p-1 | 3 received |
| Vendor bill | 16200 | | hns-wf-vendorbill-p2p-1 | 8.40, Paid In Full |
| Bill payment | 16201 | 426 | hns-wf-vendorpayment-p2p-1 | 8.40 from account 122 |

- Approvals: every purchase order in this account has `approvalstatus` null, and a new PO starts at B Pending Receipt. So purchase order approval is off here and the page shows no Approve step. Bills carry `approvalstatus` 2 (approved). The page shows Approve for a PO at status A or approvalstatus 1, and for a bill at status D or approvalstatus 1. Neither was run live.
- Purchase order to item receipt: same line payload as fulfillment, `{"item":{"items":[{"orderLine":1,"itemReceive":true,"quantity":3}]}}`. No ship status or label flags.
- Purchase order to vendor bill: transform with only `memo` and `externalId` billed the ordered quantity (4), not the received quantity (3). Edit the bill if it should match the receipt.
- Closing the last open PO line with `isClosed: true` moved the PO to H Closed.
- Vendor bill to vendor payment: `{"tranDate":"2026-11-08","account":{"id":"122"}}` paid the full open amount. The page does not offer a partial bill payment yet; that needs the `apply` sublist.
- Bill payments, item receipts and bill credits have status Y "Undefined" in SuiteQL, so their lists have no status filter.

## Lists (Phase 2)

- Filter status with the bare letter: `t.status IN ('B','F')` matched 46 purchase orders, `t.status = 'PurchOrd:B'` matched none. The old Orders filter `NOT IN ('SalesOrd:C','SalesOrd:G','SalesOrd:H')` excluded nothing, and the old Quotes filter `= 'Estimate:A'` matched nothing.
- `foreigntotal` is negative for purchase orders, item receipts, bills, bill payments and returns. Lists show `ABS(foreigntotal)`.
- Paging: `ns_runCustomSuiteQL` takes `pageIndex` (0-based) with `pageSize`. The REST SuiteQL path takes `offset`.
- Items: `item.itemtype` codes seen are InvtPart, NonInvtPart, OthCharge, Assembly, Discount. Non-inventory, service and other charge items also have `subtype` (Sale, Resale, Purchase), which picks the record type, such as `noninventoryresaleitem` or `otherchargepurchaseitem`. Inventory items have no subtype.
- Item receipts, bill payments and customer payments open on the transaction page with lines and links but no next steps.

## Fulfillment stock, serial numbers and locations (Phase 2 fixes)

Found on SO629 (customer 8 Ntags Associates, item 760 Breville Bambino Plus, location Boston), 2026-11-08.

- "You must have at least one valid line item for this transaction." The order line ships from Boston, and item 760 has no stock there. Its 4 units are at San Francisco. NetSuite drops lines with nothing committed, so no line is left. Sending a fulfillment line `location` does not help, and neither does changing only the order line's `location`.
- Changing the sales order header `location` to 2 with `ns_updateRecord` moved the lines to San Francisco and committed the unit.
- Item 760 is serialized (`item.isserialitem = 'T'`). Without numbers the fulfillment fails with "Please configure the inventory detail in line 1 of the item list."
- Worked: `{"orderLine":1,"itemReceive":true,"quantity":1,"inventoryDetail":{"inventoryAssignment":{"items":[{"issueInventoryNumber":{"id":"6152"},"quantity":1}]}}}`. It made IF 16390 from test order 16389 (external id hns-wf-salesorder-serial-1, serial BES500-DEMO-03).
- Serial and lot numbers in stock: `inventorynumber` joined to `inventorynumberlocation` (`quantityavailable > 0`).
- QUO101 location: the first save sent London (location 6, subsidiary United Kingdom) for a US customer. NetSuite refused it with "Invalid Field Value 6 for the following field: location", and the saved quote has Boston. The location search now lists only locations in the customer's or vendor's subsidiary.
- `location.subsidiary` is a text list ("2"), so `subsidiary = 2` matches nothing. Use `locationsubsidiarymap` (one row per location and subsidiary).
- Item defaults: the base price is `itemprice.price` at `pricelevel = 1`. The sales description is `item.description` (`salesdescription` does not exist in SuiteQL). The purchase side uses `cost`, then `lastpurchaseprice`, and `purchasedescription`. Many items here, 248 and 760 among them, have no base price, so NetSuite answers "Please enter a value for Amount" unless a rate is sent.
