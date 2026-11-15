import type { ReportReason } from '../types';

/** Labels for Backend.Reports.Report's reasons, in the order they're offered. */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Taciz veya zorbalık',
  inappropriate: 'Uygunsuz içerik',
  other: 'Diğer',
};
