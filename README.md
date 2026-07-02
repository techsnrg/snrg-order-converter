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
```

Without `OPENAI_API_KEY`, the extraction API returns demo rows so the review and Excel export flow can be tested.

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

## Next milestones

- Add password/email login for coordinators.
- Sync item master from ERPNext.
- Store conversion history.
- Create draft ERPNext quotation through API.
