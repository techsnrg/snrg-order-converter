# SNRG Order Converter

Private web app for converting handwritten WhatsApp sales orders into ERPNext-ready Excel rows.

## First workflow

1. Coordinator opens the private app link.
2. Uploads the handwritten order image.
3. The app extracts item rows using OpenAI vision.
4. The app cross-references extracted text with item master aliases.
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
```

Without `OPENAI_API_KEY`, the extraction API returns demo rows so the review and Excel export flow can be tested.

Without the ERPNext variables, the **Sync ERPNext** button will show a configuration error. CSV upload remains available as a fallback.

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
- `aliases`: salesperson shorthand or handwritten variations, separated with `|`.
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

## ERPNext setup

ERPNext should remain the source of truth for item codes, UOM, aliases, and conversion quantities.

### 1. Add custom fields on Item

In ERPNext, go to **Customize Form** and select **Item**.

Add these fields:

| Label | Fieldname | Type | Purpose |
| --- | --- | --- | --- |
| Sales Aliases | `custom_sales_aliases` | Small Text | Handwritten/sales-team names such as `10105 VB, 10105, 10105-VB` |
| Quotation Conversion Qty | `custom_quotation_conversion_qty` | Float | Multiplier from extracted order quantity to ERP quantity |

Example:

| ERPNext field | Value |
| --- | --- |
| Item Code | `10105-WH` |
| Item Name | `10105 WH` |
| Stock UOM | `Nos` |
| Sales Aliases | `10105 VB, 10105, 10105-VB` |
| Quotation Conversion Qty | `300` |

That means a handwritten line like `10105 VB - 01 CTN` can become `10105-WH`, quantity `300`, UOM `Nos`.

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

Open the app and click **Sync ERPNext** in the item catalogue panel. The app will fetch active ERPNext items using:

```text
GET /api/resource/Item
```

Fields fetched:

```text
item_code
item_name
stock_uom
custom_sales_aliases
custom_quotation_conversion_qty
```

## Next milestones

- Add password/email login for coordinators.
- Store conversion history.
- Create draft ERPNext quotation through API.
