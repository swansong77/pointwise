/**
 * SYNTHETIC look-alike of a personal "Credit Card Benefits Tracker" workbook (same sheet names and
 * column layout, invented values). The user's real workbook is never used in tests.
 */
import type { Sheet } from '../../src/domain/import';

export const SUMMARY_ROWS = [
  ['Credit value available', 1830],
  ['Used so far', 450],
  ['Remaining', 1380],
  ['Annual fees', 1185],
  ['Credits minus fees', 645],
  [],
  ['Benefits by card'],
];

export const BENEFIT_HEADER = [
  'Card', 'Benefit', '# Cards', 'Credit value per card ($/yr)', 'Total value', 'Used so far', 'Remaining',
  "How it's issued", 'Resets', 'Action needed', 'Notes', 'Issuer', "Mine / Spouse's",
];

export const BENEFIT_ROWS: unknown[][] = [
  ['Metro Platinum', 'Hotel credit', 1, 600, 600, 300, 300, '$300 Jan–Jun + $300 Jul–Dec', 'Semi-annual', 'Prepay', '', 'Amex', '1 / 0'],
  ['Metro Platinum', 'Dining credit', 1, 400, 400, 150, 250, '$100 per quarter', 'Quarterly', 'Enroll', '', 'Amex', '1 / 0'],
  ['Metro Platinum', 'Streaming credit', 1, 240, 240, 0, 240, '$20 per month', 'Monthly', 'Enroll', '', 'Amex', '1 / 0'],
  ['Harbor Reserve', 'Travel credit', 2, 300, 600, 0, 600, 'Automatic', 'Cardmember year', '', '', 'Chase', '1 / 1'],
  ['Harbor Reserve', 'Global Entry / TSA PreCheck', 2, 30, 60, 0, 60, '$120 every 4 years', 'Every 4 years', '', '', 'Chase', '1 / 1'],
  ['Summit Hotel Card', 'Free night certificate', 1, 0, 0, 0, 0, 'Certificate on anniversary', 'Cardmember year', '', '', 'Chase', '0 / 1'],
  ['Unknown Card', 'Mystery credit', 1, '', '', '', '', '', '', '', '', '', '1 / 0'],
];

export const CARD_HEADER = ['Owner', 'Card', 'Last digits', 'Issuer', 'Annual fee', 'Credit value', 'Credits minus fee', 'Notes', 'Open date', 'Status'];
export const CARD_ROWS: unknown[][] = [
  ['Me', 'Metro Platinum', 41007, 'Amex', 695, 1240, 545, '', '2025-03-14', 'Open'],
  ['Me', 'Harbor Reserve', '1234', 'Chase', 395, 330, -65, '', '2024-07', ''],
  ['Spouse', 'Harbor Reserve', '5678', 'Chase', 395, 330, -65, 'Authorized user on my account', '07/2024', ''],
  ['Spouse', 'Summit Hotel Card', '2222', 'Chase', 95, 0, -95, '', new Date(Date.UTC(2023, 0, 5)), ''],
  ['Me', 'Old Cash Card', '9999', 'Citi', 0, 0, 0, 'Closed 2025', '2019-02-01', 'Closed'],
  ['Me', 'Metro Platinum', 41007, 'Amex', 695, 1240, 545, 'accidental duplicate row', '2025-03-14', ''],
  ['Me', 'Bad Row Card', '4111111111111111', 'Citi', 0, 0, 0, '', 'sometime', ''],
];

export function trackerSheets(): Sheet[] {
  return [
    { name: 'Benefits', rows: [...SUMMARY_ROWS, BENEFIT_HEADER, ...BENEFIT_ROWS] as Sheet['rows'] },
    { name: 'Cards', rows: [CARD_HEADER, ...CARD_ROWS] as Sheet['rows'] },
    { name: 'Dropdown options', rows: [['Me'], ['Spouse']] },
  ];
}

/** The same workbook as .xlsx bytes (for integration tests of the upload endpoint). */
export async function trackerXlsx(): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require('exceljs') as typeof import('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const s of trackerSheets()) {
    const ws = wb.addWorksheet(s.name);
    for (const r of s.rows) ws.addRow(r as unknown[]);
  }
  // a formula cell with a cached result, like the real workbook's totals
  wb.getWorksheet('Benefits')!.getCell('B1').value = { formula: 'SUM(E9:E15)', result: 1830 } as never;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
