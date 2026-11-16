import type { ReportReason } from '../types';
import { t, type MessageKey } from '../i18n';

const REPORT_REASONS: Record<ReportReason, MessageKey> = {
  spam: 'Spam',
  harassment: 'Taciz veya zorbalık',
  inappropriate: 'Uygunsuz içerik',
  other: 'Diğer',
};

/** Backend.Reports.Report's reasons, in the order they're offered. */
export const REPORT_REASONS_IN_ORDER = Object.keys(REPORT_REASONS) as ReportReason[];

/** The label for one of Backend.Reports.Report's reasons, in the UI language. */
export function reportReasonLabel(reason: ReportReason): string {
  return t(REPORT_REASONS[reason]);
}
