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

## Item master format

The current prototype accepts item aliases as JSON in the page. Later this should be replaced by ERPNext item sync.

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
