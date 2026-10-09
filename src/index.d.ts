import type { Page } from 'playwright';

export type ContrastStatus = 'quickcheck-clear' | 'needs-review' | 'unsupported';
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
/** Coordinates are integer pixels in the background PNG raster, not document coordinates. */
export interface WorstPixel { x: number; y: number; color: RGB }
export interface PixelAnalysis {
  status: 'quickcheck-clear' | 'needs-review'; minimumRatio: number; threshold: number;
  pixelCount: number; worstPixel: WorstPixel;
}
export interface CaptureOptions { selector: string; threshold?: number }
export interface CaptureResult {
  status: ContrastStatus; selector: string; text: string; threshold: number;
  minimumRatio?: number; worstPixel?: WorstPixel;
  font: { sizePx: number; weight: number }; foreground: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  /** Unrounded CSS-pixel rectangle in document coordinates; PNG raster dimensions are integers. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Actual background PNG dimensions at CSS screenshot scale; zero when no pixels were analyzed. */
  sampleSize: { width: number; height: number };
  pixelCount: number;
  pageUrl: string; browserVersion: string; userAgent: string;
  reasons: string[];
  /** Empty strings when capture could not safely reach the corresponding screenshot. */
  images: { original: string; background: string };
  method: 'bounding-box-quickcheck'; limitations: string[]; capturedAt: string;
}
/** Chromium Page with CDP support; await captures before reusing the same Page. */
export function captureContrast(page: Page, options: CaptureOptions): Promise<CaptureResult>;
export function parseColor(value: string): RGBA;
export function luminance(rgb: RGB | RGBA): number;
export function contrastRatio(a: RGB | RGBA, b: RGB | RGBA): number;
export function textThreshold(fontSizePx: number, fontWeight?: number | 'bold'): number;
export function analyzePixels(data: ArrayLike<number>, width: number, height: number, foreground: string | RGB | RGBA, threshold?: number): PixelAnalysis;

export interface FailedCaptureRecord {
  status: 'unsupported'; selector: string; text: string; threshold: number | null;
  font: null; foreground: null; bounds: null;
  images: { original: null; background: null };
  viewport: { width: number; height: number; deviceScaleFactor: number };
  capturedAt: string; pageUrl: string; method: 'bounding-box-quickcheck';
  reasons: string[]; limitations: string[];
  error: { stage: 'navigation' | 'capture'; message: string };
  browserVersion?: string; userAgent?: string;
}
export type ReportCapture = CaptureResult | FailedCaptureRecord;
export interface EvidenceReport {
  schemaVersion: 1; createdAt: string; url: string; selector: string;
  method: 'bounding-box-quickcheck';
  summary: { status: ContrastStatus; captureCount: number; counts: Record<ContrastStatus, number> };
  methodology: { comparison: string; sampling: string; interpretation: string; review: string };
  captures: ReportCapture[];
}
export function createReport(captures: ReportCapture[], options: { url: string; selector: string; createdAt?: string }): EvidenceReport;
export function renderReport(report: EvidenceReport): string;
export function writeReport(report: EvidenceReport, directory: string): Promise<{ json: string; html: string }>;
