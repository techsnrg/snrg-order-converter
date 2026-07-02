"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { Download, FileImage, Loader2, RefreshCcw, UploadCloud } from "lucide-react";
import { sampleItemMaster } from "@/data/sample-item-master";
import type { ConvertedLine, ItemMasterRow } from "@/lib/types";

type ApiResponse = {
  customerName: string;
  lines: ConvertedLine[];
  warning?: string;
  error?: string;
};

const emptyRows: ConvertedLine[] = [];
const catalogueHeaders = ["itemCode", "itemName", "aliases", "defaultUom", "conversionQty"];

function escapeCell(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportRows(rows: ConvertedLine[]) {
  const worksheetRows = rows.map((row, index) => ({
    idx: index + 1,
    item_code: row.itemCode,
    item_name: row.itemName,
    qty: row.erpQty,
    uom: row.uom,
    handwritten_text: row.handwrittenText,
    extracted_quantity: row.quantity,
    extracted_unit: row.unit,
    confidence: row.confidence,
    needs_review: row.needsReview ? "Yes" : "No",
    notes: row.notes || ""
  }));

  const headers = Object.keys(worksheetRows[0] || { item_code: "", qty: "" });
  const htmlRows = [
    `<tr>${headers.map((header) => `<th>${escapeCell(header)}</th>`).join("")}</tr>`,
    ...worksheetRows.map(
      (row) =>
        `<tr>${headers
          .map((header) => `<td>${escapeCell(row[header as keyof typeof row] ?? "")}</td>`)
          .join("")}</tr>`
    )
  ];
  const workbookHtml = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${htmlRows.join(
    ""
  )}</table></body></html>`;
  const blob = new Blob([workbookHtml], {
    type: "application/vnd.ms-excel;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `quotation-items-${new Date().toISOString().slice(0, 10)}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let isQuoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      isQuoted = !isQuoted;
    } else if (char === "," && !isQuoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function parseCatalogueCsv(value: string): ItemMasterRow[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));

    return {
      itemCode: row.itemCode,
      itemName: row.itemName,
      aliases: row.aliases
        .split("|")
        .map((alias) => alias.trim())
        .filter(Boolean),
      defaultUom: row.defaultUom || "Nos",
      conversionQty: Number(row.conversionQty || 1)
    };
  });
}

function downloadCatalogueTemplate() {
  const sampleRows = [
    catalogueHeaders.join(","),
    '"10105-WH","10105 WH","10105 VB|10105|10105-VB","Nos","300"',
    '"GCP006-010","GCP006 010","GCP006 010|GCP006-010|GCP006","Box","1"'
  ];
  const blob = new Blob([sampleRows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "item-catalogue-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseItemMasterText(value: string): ItemMasterRow[] {
  const parsed = JSON.parse(value) as ItemMasterRow[];
  return parsed.map((row) => ({
    ...row,
    aliases: Array.isArray(row.aliases) ? row.aliases : []
  }));
}

export default function Home() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [itemMasterText, setItemMasterText] = useState(JSON.stringify(sampleItemMaster, null, 2));
  const [rows, setRows] = useState<ConvertedLine[]>(emptyRows);
  const [customerName, setCustomerName] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const reviewCount = useMemo(() => rows.filter((row) => row.needsReview).length, [rows]);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setImage(file);
    setRows(emptyRows);
    setMessage("");
    setPreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  async function handleCatalogueUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const catalogue = parseCatalogueCsv(text);
      if (!catalogue.length) {
        setMessage("Catalogue CSV has no item rows.");
        return;
      }
      setItemMasterText(JSON.stringify(catalogue, null, 2));
      setMessage(`${catalogue.length} catalogue items loaded from ${file.name}.`);
    } catch {
      setMessage("Could not read catalogue CSV.");
    } finally {
      event.target.value = "";
    }
  }

  function updateRow(index: number, patch: Partial<ConvertedLine>) {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              ...patch,
              needsReview: patch.needsReview ?? false
            }
          : row
      )
    );
  }

  async function convertOrder() {
    if (!image) {
      setMessage("Please upload an order image first.");
      return;
    }

    let itemMaster: ItemMasterRow[];
    try {
      itemMaster = parseItemMasterText(itemMasterText);
    } catch {
      setMessage("Item master JSON is not valid.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("image", image);
    formData.append("itemMaster", JSON.stringify(itemMaster));

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData
      });

      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error || "Could not convert the order.");

      setRows(data.lines || []);
      setCustomerName(data.customerName || "");
      setMessage(data.warning || "Order converted. Review highlighted rows before exporting.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not convert the order.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">SNRG internal tool</p>
          <h1>Order Converter</h1>
        </div>
        <button className="secondary-button" type="button" onClick={() => setRows(emptyRows)}>
          <RefreshCcw size={16} />
          Reset
        </button>
      </section>

      <section className="workspace">
        <div className="panel upload-panel">
          <div className="panel-title">
            <FileImage size={18} />
            <h2>Order photo</h2>
          </div>

          <label className="dropzone">
            <UploadCloud size={28} />
            <span>{image ? image.name : "Upload WhatsApp order image"}</span>
            <input accept="image/*" type="file" onChange={handleImageChange} />
          </label>

          {previewUrl ? <img className="preview" src={previewUrl} alt="Uploaded sales order" /> : null}

          <button className="primary-button" type="button" onClick={convertOrder} disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />}
            Convert
          </button>

          {message ? <p className="status">{message}</p> : null}
        </div>

        <div className="panel item-master-panel">
          <div className="panel-title">
            <h2>Item master aliases</h2>
          </div>
          <div className="catalogue-actions">
            <label className="secondary-button file-button">
              <UploadCloud size={16} />
              Upload CSV
              <input accept=".csv,text/csv" type="file" onChange={handleCatalogueUpload} />
            </label>
            <button className="secondary-button" type="button" onClick={downloadCatalogueTemplate}>
              <Download size={16} />
              Template
            </button>
          </div>
          <textarea
            value={itemMasterText}
            onChange={(event) => setItemMasterText(event.target.value)}
            spellCheck={false}
          />
        </div>
      </section>

      <section className="results">
        <div className="results-head">
          <div>
            <p className="eyebrow">{customerName || "Quotation item rows"}</p>
            <h2>{rows.length} rows extracted</h2>
          </div>
          <div className="actions">
            <span className={reviewCount ? "pill warn" : "pill"}>{reviewCount} need review</span>
            <button className="primary-button" type="button" disabled={!rows.length} onClick={() => exportRows(rows)}>
              <Download size={16} />
              Export Excel
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Handwritten</th>
                <th>Item code</th>
                <th>Item name</th>
                <th>ERP qty</th>
                <th>UOM</th>
                <th>Confidence</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr key={`${row.handwrittenText}-${index}`} className={row.needsReview ? "review-row" : ""}>
                    <td>{row.handwrittenText}</td>
                    <td>
                      <input value={row.itemCode} onChange={(event) => updateRow(index, { itemCode: event.target.value })} />
                    </td>
                    <td>
                      <input value={row.itemName} onChange={(event) => updateRow(index, { itemName: event.target.value })} />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={row.erpQty}
                        onChange={(event) => updateRow(index, { erpQty: Number(event.target.value) })}
                      />
                    </td>
                    <td>
                      <input value={row.uom} onChange={(event) => updateRow(index, { uom: event.target.value })} />
                    </td>
                    <td>{row.confidence}%</td>
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={row.needsReview}
                          onChange={(event) => updateRow(index, { needsReview: event.target.checked })}
                        />
                        Check
                      </label>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty">
                    Upload a handwritten order image to generate ERPNext-ready rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
