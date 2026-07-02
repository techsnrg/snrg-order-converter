# SNRG Order Converter

Private web app for converting handwritten WhatsApp sales orders into ERPNext-ready Excel rows.

## First workflow

1. Coordinator opens the private app link.
2. Uploads the handwritten order image.
3. The app extracts item rows using OpenAI vision.
4. The app cross-references extracted text with ERPNext item codes and parsing rules.
5. Coordinator reviews low-confidence rows.
6. Coordinator exports an Excel-compatible `.xls` file and copies columns into ERPNext Quotation Items.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your OpenAI API key to `.env.local`:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
ERPNEXT_BASE_URL=https://your-erpnext-site.com
ERPNEXT_API_KEY=...
ERPNEXT_API_SECRET=...
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Without `OPENAI_API_KEY`, the extraction API returns demo rows so the review and Excel export flow can be tested.

Without the ERPNext variables, the **Sync ERPNext** button will show a configuration error. CSV upload remains available as a fallback.

Without the Supabase variables, the item catalogue is cached only in the current browser. With Supabase configured, ERPNext sync and CSV upload save one shared catalogue for all coordinators.

## Item catalogue

The page can load an item catalogue CSV exported from Excel. Use the **Template** button in the app, or create a CSV with these columns:

```csv
itemCode,itemName,aliases,defaultUom,conversionQty
"10105-WH","10105 WH","10105 VB|10105|10105-VB","Nos","300"
"GCP006-010","GCP006 010","GCP006 010|GCP006-010|GCP006","Box","1"
```

Column meaning:

- `itemCode`: exact ERPNext item code to paste/create in quotation item table.
- `itemName`: readable item name from ERPNext.
- `aliases`: optional fallback aliases, separated with `|`. Use this only for exceptions; normal shorthand should be handled by parsing rules.
- `defaultUom`: ERPNext UOM for the quotation row.
- `conversionQty`: multiplier from extracted order quantity to ERP quantity. Example: if `1 CTN` should become `300 Nos`, use `300`.

The imported CSV is converted into the JSON shown in the page:

```json
[
  {
    "itemCode": "10105-WH",
    "itemName": "10105 WH",
    "aliases": ["10105 VB", "10105", "10105-VB"],
    "defaultUom": "Nos",
    "conversionQty": 300
  }
]
```

## Supabase shared catalogue cache

Supabase stores the latest synced item catalogue so coordinators do not need to sync ERPNext on every device/browser.

The app uses this table:

```sql
public.order_converter_cache
```

The table has RLS enabled. Browser clients do not talk to Supabase directly; Next.js API routes use `SUPABASE_SERVICE_ROLE_KEY` on the server.

On page load, the app tries this order:

1. Load shared catalogue from Supabase.
2. Fall back to browser cache.
3. Fall back to bundled sample items.

When **Sync ERPNext** succeeds, the app also saves that item catalogue to Supabase.

## ERPNext setup

ERPNext should remain the source of truth for item codes, stock UOM, and UOM conversion factors. Handwritten shorthand logic should live in the app, not as thousands of item aliases.

### 1. Maintain UOM conversions on Item

No custom conversion field is required if the Item already has UOM conversion rows.

Example:

| ERPNext field | Value |
| --- | --- |
| Item Code | `10105-WH` |
| Item Name | `10105 WH` |
| Stock UOM | `Nos` |

In **Units of Measure** on the Item:

| UOM | Conversion Factor |
| --- | --- |
| Nos | `1` |
| Box | `20` |
| Carton | `600` |

That means once the app resolves a handwritten line to `10105-WH`:

| Written quantity | ERP quantity |
| --- | --- |
| `10 Box` | `200 Nos` |
| `1 CTN` | `600 Nos` |
| `1 carton` | `600 Nos` |
| `1 cartoon` | `600 Nos` |

The app treats `CTN`, `carton`, and `cartoon` as ERPNext UOM `Carton`.

### Parsing rules live in the app

The app should learn order-writing patterns separately from ERPNext. Examples:

| Written by sales | App interpretation |
| --- | --- |
| `10105 VB` | `10105-VB` |
| `GCP006 010` | `GCP006-010` |
| `GCSP006`, then `"` + `010` | `GCSP006`, then `GCSP010` |

These rules are not item aliases. They are document-level parsing logic, because the meaning can depend on the previous row, punctuation, or salesperson writing style.

### 2. Create an API user

Create a dedicated ERPNext user, for example:

```text
order.converter@yourcompany.com
```

Give it read access to Item. In many ERPNext setups this can be a role such as **Item Manager**, **Stock User**, or a custom read-only role with Item read permission.

Then open the user and generate:

- API Key
- API Secret

### 3. Configure the app

Create `.env.local`:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
ERPNEXT_BASE_URL=https://your-erpnext-site.com
ERPNEXT_API_KEY=your_api_key
ERPNEXT_API_SECRET=your_api_secret
```

Restart the dev server after changing `.env.local`.

### 4. Sync items

Open the app and click **Sync ERPNext** in the item catalogue panel. The app shows progress while it loads the item list and each item's UOM conversion rows.

The app will fetch active ERPNext items using:

```text
GET /api/resource/Item
```

Fields fetched:

```text
item_code
item_name
stock_uom
```

For each item, the app also opens the Item document and reads its `uoms` child table to get conversion factors such as `Box = 20` and `Carton = 600`.

## Next milestones

- Add password/email login for coordinators.
- Store conversion history.
- Create draft ERPNext quotation through API.
