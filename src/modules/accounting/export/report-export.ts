import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { z } from "zod";

export const reportExportFormatSchema = z.enum(["xlsx", "pdf"]);
export const trialBalanceExportViewSchema = z.enum(["flat", "grouped"]);

export type ReportExportFormat = z.infer<typeof reportExportFormatSchema>;
export type ExportColumnType = "text" | "number";
export type ExportCell = string | number | null;

export type ExportColumn = {
  label: string;
  align: "left" | "center" | "right";
  type: ExportColumnType;
  widthWeight?: number;
};

export type ExportRow = {
  cells: ExportCell[];
  indent?: number;
  bold?: boolean;
};

export type ExportTable = {
  title: string;
  subtitleLines: string[];
  columns: ExportColumn[];
  rows: ExportRow[];
  footerRows: ExportRow[];
  indentColumn?: number;
  footnotes?: string[];
};

function dateStamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

export function reportExportFilename(
  slug: string,
  dates: { from?: string | Date; to?: string | Date; asOf?: string } = {}
): string {
  const from = dates.from ? dateStamp(dates.from) : undefined;
  const to = dates.to ? dateStamp(dates.to) : undefined;
  const datePart = dates.asOf
    ? dates.asOf
    : from && to
      ? `${from}-to-${to}`
      : to ?? from ?? new Date().toISOString().slice(0, 10);
  return `${slug}-${datePart}`;
}

function cellText(value: ExportCell, type: ExportColumnType): string {
  if (value === null) return "";
  return type === "number" ? Number(value).toFixed(2) : String(value);
}

function excelWorksheetName(title: string): string {
  const sanitized = title
    .replace(/[\\\/?*:\[\]]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, 31)
    .trim();
  return sanitized || "Report";
}

function addExcelRow(
  sheet: ExcelJS.Worksheet,
  row: ExportRow,
  table: ExportTable
): ExcelJS.Row {
  const excelRow = sheet.addRow(row.cells);
  row.cells.forEach((value, index) => {
    const cell = excelRow.getCell(index + 1);
    const column = table.columns[index];
    if (column.type === "number" && typeof value === "number") {
      cell.numFmt = "#,##0.00";
    }
    cell.alignment = {
      horizontal: column.align,
      ...(row.indent && index === (table.indentColumn ?? 0)
        ? { indent: row.indent }
        : {}),
    };
    if (row.bold) cell.font = { bold: true };
  });
  return excelRow;
}

export async function writeExcel(table: ExportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(excelWorksheetName(table.title));
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
  sheet.pageSetup.orientation =
    table.columns.length > 5 ? "landscape" : "portrait";

  const titleRow = sheet.addRow([table.title]);
  titleRow.font = { bold: true, size: 16 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, table.columns.length);
  for (const subtitle of table.subtitleLines) {
    const row = sheet.addRow([subtitle]);
    sheet.mergeCells(row.number, 1, row.number, table.columns.length);
  }

  const headerRow = sheet.addRow(table.columns.map((column) => column.label));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, index) => {
    cell.alignment = { horizontal: table.columns[index - 1].align };
    cell.border = { bottom: { style: "thin" } };
  });

  for (const row of table.rows) addExcelRow(sheet, row, table);
  for (const row of table.footerRows) {
    const excelRow = addExcelRow(sheet, row, table);
    excelRow.eachCell((cell) => {
      cell.border = { top: { style: "thin" } };
    });
  }
  for (const footnote of table.footnotes ?? []) {
    const row = sheet.addRow([footnote]);
    row.font = { italic: true, size: 9 };
    sheet.mergeCells(row.number, 1, row.number, table.columns.length);
  }

  sheet.columns.forEach((column, index) => {
    const headerWidth = table.columns[index].label.length;
    let contentWidth = headerWidth;
    for (const row of [...table.rows, ...table.footerRows]) {
      contentWidth = Math.max(
        contentWidth,
        cellText(row.cells[index] ?? null, table.columns[index].type).length +
          (row.indent && index === (table.indentColumn ?? 0)
            ? row.indent * 2
            : 0)
      );
    }
    column.width = Math.max(
      10,
      Math.min(48, table.columns[index].type === "number" ? 16 : contentWidth + 2)
    );
  });
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function textForCell(value: ExportCell, column: ExportColumn): string {
  return cellText(value, column.type);
}

export async function writePdf(table: ExportTable): Promise<Buffer> {
  const landscape = table.columns.length > 5;
  const doc = new PDFDocument({
    size: "A4",
    layout: landscape ? "landscape" : "portrait",
    margins: { top: 34, bottom: 34, left: 38, right: 38 },
    bufferPages: true,
    autoFirstPage: false,
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const margin = 38;
  doc.addPage({
    size: "A4",
    layout: landscape ? "landscape" : "portrait",
    margins: { top: 34, bottom: 34, left: margin, right: margin },
  });
  const pageWidth = () => doc.page.width - margin * 2;
  const bodyBottom = () => doc.page.height - margin - 24;
  const allColumnIndexes = table.columns.map((_, index) => index);
  const splitSectorColumns = table.columns.length > 14;
  const repeatedColumnIndexes = table.indentColumn === 1 ? [0, 1] : [0];
  const finalColumnIndex = table.columns.length - 1;
  const variableColumnIndexes = allColumnIndexes.filter(
    (index) =>
      !repeatedColumnIndexes.includes(index) &&
      (!splitSectorColumns || index !== finalColumnIndex)
  );
  const pageCapacity = Math.max(1, Math.floor((pageWidth() - 220) / 48));
  const columnGroups = splitSectorColumns
    ? Array.from(
        { length: Math.ceil(variableColumnIndexes.length / pageCapacity) },
        (_, groupIndex) => [
          ...repeatedColumnIndexes,
          ...variableColumnIndexes.slice(
            groupIndex * pageCapacity,
            (groupIndex + 1) * pageCapacity
          ),
          finalColumnIndex,
        ]
      )
    : [allColumnIndexes];

  let activeColumnIndexes = columnGroups[0];
  let activeColumns = activeColumnIndexes.map((index) => table.columns[index]);
  let activeWidths: number[] = [];
  let fontSize = 8;

  const setActiveColumns = (indexes: number[]) => {
    activeColumnIndexes = indexes;
    activeColumns = indexes.map((index) => table.columns[index]);
    const weightTotal = activeColumns.reduce(
      (total, column) => total + (column.widthWeight ?? 1),
      0
    );
    activeWidths = activeColumns.map(
      (column) => (pageWidth() * (column.widthWeight ?? 1)) / weightTotal
    );
    fontSize = activeColumns.length > 10 ? 6 : activeColumns.length > 7 ? 7 : 8;
  };
  setActiveColumns(activeColumnIndexes);

  const drawTableHeader = (top: number): number => {
    doc.font("Helvetica-Bold").fontSize(fontSize);
    const heights = activeColumns.map((column, index) =>
      doc.heightOfString(column.label, {
        width: activeWidths[index] - 8,
        align: column.align,
      })
    );
    const rowHeight = Math.max(18, ...heights.map((height) => height + 8));
    doc.rect(margin, top, pageWidth(), rowHeight).fill("#eeeeee");
    doc.fillColor("#111111");
    let left = margin;
    activeColumns.forEach((column, index) => {
      doc.text(column.label, left + 4, top + 4, {
        width: activeWidths[index] - 8,
        height: rowHeight - 8,
        align: column.align,
        ellipsis: true,
      });
      left += activeWidths[index];
    });
    doc.moveTo(margin, top + rowHeight).lineTo(margin + pageWidth(), top + rowHeight).stroke("#666666");
    return top + rowHeight;
  };

  const drawPageHeader = (): number => {
    const top = 34;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111");
    doc.text("Protection One (Pvt.) Ltd.", margin, top, { width: pageWidth() });
    doc.fontSize(11).text(table.title, margin, top + 18, { width: pageWidth() });
    doc.font("Helvetica").fontSize(8);
    let subtitleY = top + 35;
    for (const line of table.subtitleLines) {
      doc.text(line, margin, subtitleY, { width: pageWidth() });
      subtitleY += 11;
    }
    if (columnGroups.length > 1) {
      const firstColumn = activeColumnIndexes[repeatedColumnIndexes.length];
      const lastVariableColumn =
        activeColumnIndexes[activeColumnIndexes.length - 2];
      doc.text(
        `Columns ${firstColumn + 1}-${lastVariableColumn + 1} of ${table.columns.length - repeatedColumnIndexes.length - 1}`,
        margin,
        subtitleY,
        { width: pageWidth() }
      );
      subtitleY += 11;
    }
    return drawTableHeader(subtitleY + 5);
  };

  const addPage = (): number => {
    doc.addPage({
      size: "A4",
      layout: landscape ? "landscape" : "portrait",
      margins: { top: 34, bottom: 34, left: margin, right: margin },
    });
    return drawPageHeader();
  };

  let y = 0;

  const drawRow = (row: ExportRow): number => {
    doc.font(row.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const heights = activeColumns.map((column, displayIndex) => {
      const index = activeColumnIndexes[displayIndex];
      const indent =
        row.indent && index === (table.indentColumn ?? 0) ? row.indent * 10 : 0;
      return doc.heightOfString(textForCell(row.cells[index] ?? null, column), {
        width: Math.max(1, activeWidths[displayIndex] - 8 - indent),
        align: column.align,
      });
    });
    const height = Math.max(16, ...heights.map((item) => item + 6));
    if (y + height > bodyBottom()) y = addPage();

    let left = margin;
    activeColumns.forEach((column, displayIndex) => {
      const index = activeColumnIndexes[displayIndex];
      const indent =
        row.indent && index === (table.indentColumn ?? 0) ? row.indent * 10 : 0;
      doc.text(textForCell(row.cells[index] ?? null, column), left + 4 + indent, y + 3, {
        width: Math.max(1, activeWidths[displayIndex] - 8 - indent),
        height: height - 6,
        align: column.align,
        ellipsis: true,
      });
      left += activeWidths[displayIndex];
    });
    if (row.bold) {
      doc.moveTo(margin, y + height).lineTo(margin + pageWidth(), y + height).stroke("#aaaaaa");
    }
    return y + height;
  };

  for (const [groupIndex, group] of columnGroups.entries()) {
    setActiveColumns(group);
    y = groupIndex === 0 ? drawPageHeader() : addPage();

    for (const row of table.rows) y = drawRow(row);
    for (const row of table.footerRows) y = drawRow({ ...row, bold: true });
    for (const footnote of table.footnotes ?? []) {
      doc.font("Helvetica-Oblique").fontSize(7);
      const height = doc.heightOfString(footnote, { width: pageWidth() });
      if (y + height + 8 > bodyBottom()) y = addPage();
      doc.text(footnote, margin, y + 6, { width: pageWidth() });
      y += height + 10;
    }
  }

  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(pages.start + index);
    doc.font("Helvetica").fontSize(8).fillColor("#555555");
    doc.text(`Page ${index + 1} of ${pages.count}`, margin, doc.page.height - 24, {
      width: pageWidth(),
      align: "center",
    });
  }
  doc.end();
  return finished;
}

export async function reportExportResponse(
  table: ExportTable,
  format: ReportExportFormat,
  filename: string
): Promise<Response> {
  const bytes = format === "xlsx" ? await writeExcel(table) : await writePdf(table);
  const contentType =
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}.${format}"`,
    },
  });
}
