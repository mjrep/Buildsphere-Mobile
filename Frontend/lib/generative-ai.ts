import { API_URL } from './api';

const withRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && (error.message?.includes('503') || error.message?.includes('429'))) {
      await new Promise((res) => setTimeout(res, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export interface GeminiPanel {
  id: string;
  bbox: number[];
  visibility_percentage: number;
  panel_type: 'Residential Window' | 'Balcony Door Glass' | 'Curtain Wall Glass' | 'Fixed Glass Panel';
  confidence: number;
  requires_manual_verification: boolean;
  notes?: string;
}

export interface UncertainDetection {
  id: string;
  bbox: number[];
  reason: string;
  confidence: number;
}

export interface GeminiAuditResult {
  count: number;
  hasWarnings: boolean;
  warningMessage: string | null;
  summary: string;
  detectionMode: 'gemini-only';
  avgConfidence: number;
  panels: GeminiPanel[];
  uncertainDetections: UncertainDetection[];
}

interface BackendGlassAnalysisResponse {
  total_valid_panels: number;
  ai_detected_count: number;
  verified_panel_count: number;
  summary: string;
  detection_mode: 'gemini-only';
  detection_confidence?: number;
  avg_confidence?: number;
  has_warnings: boolean;
  warning_message: string;
  panels: GeminiPanel[];
  uncertain_detections: UncertainDetection[];
}

export const countGlassPanels = async (
  _base64Image: string,
  _mimeType: string,
  photoUri?: string
): Promise<BackendGlassAnalysisResponse> => {
  if (!photoUri) {
    throw new Error('Photo URI is required for backend Gemini image analysis.');
  }

  return withRetry(async () => {
    const filename = photoUri.split('/').pop() || 'photo.jpg';
    const ext = (filename.split('.').pop() || 'jpeg').toLowerCase();
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const formData = new FormData();

    formData.append('image', {
      uri: photoUri,
      name: filename,
      type: mimeType,
    } as any);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    const response = await fetch(`${API_URL}/api/ai/glass-analysis`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI analysis failed (${response.status}): ${body.substring(0, 300)}`);
    }

    return response.json();
  });
};

export const analyzeGlassPanelsWithGemini = async (
  base64Image: string,
  mimeType: string,
  photoUri?: string
): Promise<GeminiAuditResult> => {
  try {
    const analysis = await countGlassPanels(base64Image, mimeType, photoUri);
    const panels = Array.isArray(analysis.panels) ? analysis.panels : [];
    const uncertainDetections = Array.isArray(analysis.uncertain_detections)
      ? analysis.uncertain_detections
      : [];
    const count = Number(analysis.total_valid_panels || analysis.ai_detected_count || panels.length || 0);

    const avgConfidence =
      typeof analysis.avg_confidence === 'number'
        ? analysis.avg_confidence
        : typeof analysis.detection_confidence === 'number'
          ? analysis.detection_confidence
          : panels.length > 0
        ? panels.reduce((sum, panel) => sum + panel.confidence, 0) / panels.length
        : 0;

    return {
      count,
      hasWarnings: Boolean(analysis.has_warnings),
      warningMessage: analysis.warning_message || null,
      summary: analysis.summary,
      detectionMode: analysis.detection_mode || 'gemini-only',
      avgConfidence,
      panels,
      uncertainDetections,
    };
  } catch (error: any) {
    console.error('GEMINI_BACKEND_AUDIT_ERROR:', error);
    throw new Error(`Gemini Audit Failed: ${error.message || 'Unknown Error'}`);
  }
};
