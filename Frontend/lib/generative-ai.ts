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

export interface CVDetection {
  id?: string;
  bounding_box: number[];
  confidence_score: number;
  label: string;
  status: 'full' | 'partial' | 'unclear';
  counted: boolean;
  visibility_percentage?: number;
  panel_type?: GeminiPanel['panel_type'];
  requires_manual_verification?: boolean;
  notes?: string;
}

export interface CVAuditResult {
  count: number;
  partialPanels: number;
  unclearPanels: number;
  excludedPanels: number;
  hasWarnings: boolean;
  warningMessage: string | null;
  summary: string;
  annotatedImage: string | null;
  detections: CVDetection[];
  detectionMode: 'gemini-only' | 'gemini' | 'box' | 'grid' | 'gemini-fallback';
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

export const hybridGlassAudit = async (
  base64Image: string,
  mimeType: string,
  photoUri?: string
): Promise<CVAuditResult> => {
  console.log('DEBUG: Backend Gemini glass audit commencing');

  try {
    const analysis = await countGlassPanels(base64Image, mimeType, photoUri);
    const panels = Array.isArray(analysis.panels) ? analysis.panels : [];
    const uncertainDetections = Array.isArray(analysis.uncertain_detections)
      ? analysis.uncertain_detections
      : [];
    const count = Number(analysis.total_valid_panels || analysis.ai_detected_count || panels.length || 0);

    const detections: CVDetection[] = panels.map((panel) => ({
      id: panel.id,
      bounding_box: panel.bbox,
      confidence_score: panel.confidence,
      label: panel.panel_type,
      status: panel.requires_manual_verification ? 'unclear' : 'full',
      counted: true,
      visibility_percentage: panel.visibility_percentage,
      panel_type: panel.panel_type,
      requires_manual_verification: panel.requires_manual_verification,
      notes: panel.notes,
    }));

    const avgConfidence =
      typeof analysis.avg_confidence === 'number'
        ? analysis.avg_confidence
        : typeof analysis.detection_confidence === 'number'
          ? analysis.detection_confidence
          : detections.length > 0
        ? detections.reduce((sum, detection) => sum + detection.confidence_score, 0) / detections.length
        : 0;

    return {
      count,
      partialPanels: 0,
      unclearPanels: uncertainDetections.length,
      excludedPanels: 0,
      hasWarnings: Boolean(analysis.has_warnings),
      warningMessage: analysis.warning_message || null,
      summary: analysis.summary,
      annotatedImage: null,
      detections,
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

export const getBuildsphereAI = async (p: string) => {
  throw new Error(`Text Gemini calls must go through the backend. Prompt was not sent: ${p.slice(0, 40)}`);
};

export const analyzeBuildsphereImage = async (p: string, _b: string, _m: string) => {
  throw new Error(`Image Gemini calls must go through the backend. Prompt was not sent: ${p.slice(0, 40)}`);
};
