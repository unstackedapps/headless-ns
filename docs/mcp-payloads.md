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

## Found by the Playwright runs (Phase 2)

- NetSuite MCP answers HTTP 429 when the app sends too many calls at once (Orders list and an order page failed together). The server now runs at most 3 tool calls at a time and retries reads after 1, 2.5 and 5 seconds. Writes are never retried.
- A fulfillment at Picked or Packed does not count in `transactionline.quantityshiprecv`. It shows in `quantitypicked`. The order stays B Pending Fulfillment until the fulfillment ships.
- Vendor bills have an empty `tranid` in this account. `transactionnumber` (for example 415) is the number to show.
- Customer payments name the customer in `customer`, not `entity`.

UI runs on 2026-11-08, memo "headless-ns workflow test":

| Run | Records |
|---|---|
| Quote to paid invoice | SO631 (16393), INV435, PYMT400 |
| Purchase order to paid bill | PO447, IR440 (16690), bill 415 (16789), bill payment 427 (16590) |

## Procure-to-pay gaps and lot numbers (Phase 4)

Tested on 2026-11-08 with vendor 628 (Core4Solutions), location 2, item 693 (GAR002L, lot) and item 541 (KAP001). Payload tests have memo "headless-ns payload test p4" and external ids `hns-p4-*`.

| Record | Internal id | Number | What it tested |
|---|---|---|---|
| Purchase order | 17089 | | 5 of GAR002L and 4 of KAP001 |
| Item receipt | 17090 | | 3 GAR002L into new lots HNS-P4-LOT-A (2) and HNS-P4-LOT-B (1), 2 KAP001 |
| Vendor bill | 17091 | | Billed the received 3 and 2, total 10.20 |
| Item receipt | 17092 | | The other 2 KAP001, GAR002L line `itemReceive:false` |
| Vendor bill | 17093 | 417 | GAR002L at quantity 0, KAP001 at 2, total 4.20 |
| Bill payment | 17094 | | 5.00 to bill 17091 and 1.20 to bill 17093 |
| Purchase order | 17095 | | `supervisorApproval:false`, saved as approved anyway |

### Bill a purchase order for chosen quantities

Bill lines have `orderLine`. Send one line per order line with the quantity to bill:

```json
{"item":{"items":[{"orderLine":1,"quantity":3},{"orderLine":2,"quantity":2}]}}
```

- Without `item`, the transform bills the ordered quantity.
- A line with `quantity: 0` stays on the bill at 0. The transform has no way to drop a line.
- After billing everything received, a partly received PO reads D "Partially Received", not E. The page offers Bill on D while a line has received units that are not billed (`quantityshiprecv > quantitybilled`).

### Partial bill payment

Vendor payment `apply` lines are keyed by `doc`. A transform from one bill pays any open bill of the vendor:

```json
{"apply":{"items":[{"doc":{"id":"17091"},"apply":true,"amount":5},{"doc":{"id":"17093"},"apply":true,"amount":1.2}]}}
```

Payment 17094 totaled 6.20 and left 5.20 open on 17091 and 3.00 on 17093. The transform pre-applies the source bill in full. When the user unticks that bill, the server also sends `{"doc":{"id":<source>},"apply":false}`. Bill payment 430 (17108) ran this way from bill 420 and paid only bill 419; bill 420 stayed at 10.00 open.

### Lot and serial numbers on receipts

Receipts name new numbers with `receiptInventoryNumber` (text). Fulfillments pick numbers in stock with `issueInventoryNumber` (`{id}`). Several entries split a line:

```json
{"orderLine":1,"itemReceive":true,"quantity":3,"inventoryDetail":{"inventoryAssignment":{"items":[{"receiptInventoryNumber":"HNS-P4-LOT-A","quantity":2},{"receiptInventoryNumber":"HNS-P4-LOT-B","quantity":1}]}}}
```

NetSuite created both lots at San Francisco with 2 and 1 available.

### Purchase order approval

Superseded: approval routing is now on and runs through a workflow. See "Purchase order and bill approval workflow" below. What follows is what we found before that.

- Every PO here has `approvalstatus` null and starts at B Pending Receipt.
- The PO metadata has `supervisorApproval` (boolean), and `ns_getRecordActionMetadata` lists an `approve` action. PO 17095, created with `supervisorApproval:false`, read back `true` at B Pending Receipt. The account ignores the box.
- Approval needs an account change. Setup > Accounting > Accounting Preferences > Approval Routing > Purchase Order turns on approval routing, and it needs an approval workflow (SuiteFlow) first. Purchase orders then start at Pending Approval with `approvalstatus` 1. Sources: Oracle's help pages "Switching From the Approval Routing Feature to SuiteFlow for Purchases" and "Supervisors, Approvers, and Approval Limits". They disagree on how the preference and the older supervisor approval interact, so check the account before changing anything.
- The page already offers Approve for a PO at status A or `approvalstatus` 1, by setting `approvalStatus` to 2. That write is untested. Do not switch it to the `approve` action: for sales orders that action answers "The approve api is not available to your company" (see below).

### UI runs (`e2e/gaps.live.ts`, memo "headless-ns phase4 test")

| Flow | Records |
|---|---|
| Lot receipt, bill for the received quantity, partial payment | PO451 (17098): 5 ordered. IR443 (17190): 3 received into lots HNS-MW8ADV1A-A (2) and -B (1). Bill 418 (17099): 3 × 2.00 = 6.00. Bill payment 429 (17191): 5.00, 4.00 to bill 418 (2.00 left) and 1.00 to bill 417 (2.00 left). |
| Lot fulfillment | SO634 (17096), 3 of item 759. IF473 (17097) shipped 2 from LOT-DEMO-A and 1 from LOT-DEMO-B (available went from 20 to 18 and 19). |

PO450 (17189) is left at Pending Receipt from a run that stopped on a test selector before receiving.

## Approval, serial receipts and payments that skip their bill (Phase 4b)

Run on 2026-11-08 through the screens (`e2e/gaps.live.ts`), memo "headless-ns phase4 test".

### Sales order approval

- `ns_createRecord` with `"orderStatus":{"id":"A"}` makes the order at A Pending Approval. SO635 (17289), external id hns-p4b-so-appr-1. No setting change needed.
- `ns_executeRecordAction` with `actionId: "approve"` fails with "The approve api is not available to your company", even though `ns_getRecordActionMetadata` lists the action. SO636 (17100) is left at Pending Approval from that try.
- `ns_updateRecord` with `{"orderStatus":{"id":"B"}}` approves it: SO635 moved to B Pending Fulfillment. The Approve step now sends this.
- UI run: SO637 (17104) created at A, then Approve on its page moved it to B.

### Serial numbers on a receipt

Receipts take one `receiptInventoryNumber` per unit with quantity 1, the same shape as lots. PO453 (17105), 2 of item 761 (serialized), received as IR445 (17106) with serials HNS-MW8BOH37-S1 and -S2. Both exist at San Francisco with 1 available. An earlier run that stopped at the payment step left PO452, IR444 (serials HNS-MW8BJ0DH-S1 and -S2) and bill 419 (17103).

### Bill payment that leaves out its bill

Started Pay bill on bill 420 (17107, 10.00), unticked it and paid 0.50 of bill 419 instead. Bill payment 430 (17108) applied 0.50 to 17103 only, and bill 420 still shows 10.00 open.

The first try failed in the browser before anything was written: the bill list loads twice in development, and the second load wiped the tick on bill 419. The list now keeps ticks and amounts when it reloads.

## Ask with serial items, missing stock and other currencies (Phase 4b)

Run on 2026-11-08 through the Ask drawer (`e2e/ask.live.ts`) with Gemma 4 in LM Studio, memo "headless-ns ask test".

### What went wrong before the fixes

- Gemma did not follow the prompt's stock check. For an order at Boston (location 1) for item 761, which has stock only at San Francisco, it proposed three fulfillments in a row. It also used a San Francisco serial number. NetSuite answered "You must have at least one valid line item for this transaction" each time, so only SO639 (17389) was written.
- It also left the location off that order, though the request named one. SO638 (17192) and SO639 have no location on any line.
- On a serial item, the first fulfillment proposal had no serial numbers and would have failed. The second one, after it looked up numbers, worked: QUO106 (17109) was created once, then SO641 (17391) and IF474 (17392) with serial HNS-MW8BJ0DH-S1.

### What the server does now

- Before Ask shows a sales order fulfillment for approval, the server reads the order's open inventory lines (`shipLinesSql`: line location, else the mainline location) and stock (`stockSql`). A short line, or an order with no location, goes back to the model as the tool's error. The error names the locations that have enough. The person never sees a Run button for it.
- If stock is fine, serial and lot lines that ship without `inventoryDetail` go back the same way. The error lists up to 10 numbers in stock at that location (`numbersSql`).
- The repeat check ignores `externalId`, which is new on every proposal. So two identical proposals now stop the request.
- The prompt asks for the stock check, the serial `inventoryDetail` shape and the header `location`.

### Runs after the fixes

| Request | Result |
|---|---|
| Sales order at Boston for item 761, then fulfill | SO640 (17489) at Boston. No fulfillment proposed. Ask answered that location 1 has no stock of item 761. |
| Quote, order and fulfillment of serial item 761 at San Francisco | QUO108 (17393), SO642 (17394), IF475 (17490) with serial HNS-MW8BJ0DH-S2. Only one fulfillment proposal, with its serial number shown in the summary. |
| Quote for customer 1194 "388 United Kingdom (buys from US)" | Summary read "total 20.00 British pound" and "2 × SPC002 at 10.00 British pound". Cancelled, nothing written. |

Write summaries now name the currency from the customer or vendor (`customer.currency` or `vendor.currency`), or from `data.currency` when the payload sets one. A transform has no amount in its summary. Without a known currency the figure has no symbol.

## Purchase order and bill approval workflow (Phase 4c)

Set up on 2026-11-08 at the user's request, in the NetSuite UI as Administrator.

### Account changes, and how to undo them

| Where | Change | Old value | Who |
|---|---|---|---|
| Setup > Accounting > Accounting Preferences > Approval Routing | Purchase Order and Vendor Bill turned on | Off: every PO had `approvalstatus` null and started at B | The user |
| Customization > Workflow > Workflows | New workflow 10 "headless-ns approval - PO and Bill", script id `customworkflow_hns_approval_po` | Did not exist | This session |

The user turned on the preferences before this session's work. This session did not check or change Enable Features (SuiteFlow, Approval Routing).

To undo: mark workflow 10 Inactive (or delete it), then clear Purchase Order and Vendor Bill under Approval Routing.

Bundle 16707 already had "3 Way Match Vendor Bill Approval" (3), "Vendor Bill Approval Routing Workflow" (4) and "Invoice Approval Workflow" (5). All three are Not Initiating, and none was changed.

### The workflow

- Record type Transaction, sub types Purchase Order and Vendor Bill. One workflow covers both, so both use the same action ids. The orchestrator asked for two workflows; one does the same job.
- Event based, On Create, all trigger types. Release status Released. Execute as Admin. Contexts: the default 40, plus Agentic Commerce.
- State **Pending Approval** (30, start state). On entry it sets Approval Status = Pending Approval. Before record load it adds button Approve (action `workflowaction_hns_approve`) and button Reject (`workflowaction_hns_reject`), both with "Expose to Record Action API". It moves to Approved on the Approve button and to Rejected on the Reject button.
- State **Approved** (31): on entry it sets Approval Status = Approved.
- State **Rejected** (32): on entry it sets Approval Status = Rejected.

### Calls that work

- `ns_getRecordActionMetadata` for purchaseorder and vendorbill now lists `WORKFLOWACTION_HNS_APPROVE` and `WORKFLOWACTION_HNS_REJECT`.
- `ns_executeRecordAction` `{"recordType":"purchaseorder","recordId":"17395","actionId":"WORKFLOWACTION_HNS_APPROVE"}` answers "Workflow action Approve processed." PO454 moved from A Pending Supervisor Approval (approvalstatus 1) to B Pending Receipt (approvalstatus 2).
- The Reject action moved PO455 (17396) to C Rejected by Supervisor (approvalstatus 3).
- Bill 421 (17398), made from PO454, started at D Pending Approval (approvalstatus 1). Approve moved it to A Open.
- These ran as role `customrole_opensuitemcp`, the role headless-ns signs in with, so that role can approve. The Approve and Reject steps on the transaction page now call these actions. Setting `approvalStatus` directly would leave the workflow waiting in Pending Approval.

### UI runs (`e2e/gaps.live.ts`)

| Flow | Records |
|---|---|
| PO approval, receipt, bill approval | PO456 (17399) waited at Pending Supervisor Approval with no Receive step. Approve moved it to Pending Receipt. IR447 (17400). Bill 422 (17401) waited at Pending Approval with no Pay bill step. Approve moved it to Open and showed Pay bill. |
| PO rejection | PO457 (17589). Reject moved it to Rejected by Supervisor, with nothing left to do. |
| Earlier flows, now with approval | Lot receipt: PO460 (17591), IR450, bill 425, payment 433. Serial receipt and payment from another bill: PO459 (17689), IR449, bill 424 (10.00 still open), payment 432. Each PO and bill was approved on its page first. |
