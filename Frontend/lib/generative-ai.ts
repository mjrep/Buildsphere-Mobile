/**
 * Generative AI mobile helper
 *
 * Sends site photos to the BuildSphere backend AI endpoint. The mobile app never
 * stores Gemini keys or calls Gemini directly; the backend owns prompt/parser logic
 * and returns the stable count/confidence/summary contract.
 */
import { API_URL, apiFetch } from './api';
import { qaDebug } from '../utils/qaDebug';
import { Platform } from 'react-native';

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 4000): Promise<T> => {
  // Retry only transient AI/backend failures so users are not forced to retake photos immediately.
  try {
    return await fn();
  } catch (error: any) {
    const msg = error?.message?.toLowerCase() || '';
    if (retries > 0 && (msg.includes('503') || msg.includes('429') || msg.includes('unavailable') || msg.includes('timeout'))) {
      console.warn(`AI Analysis failed. Retrying in ${delay}ms...`, error.message);
      await new Promise((res) => setTimeout(res, delay));
      return withRetry(fn, retries - 1, delay * 1.5);
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

const getGlassAnalysisBaseUrls = () => {
  // Android emulators may need loopback aliases when testing against a local LAN backend.
  const urls = [API_URL];

  if (Platform.OS === 'android') {
    const localhostUrl = API_URL.replace(
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?/i,
      (_match, port = '') => `http://127.0.0.1${port}`
    );
    const emulatorUrl = API_URL.replace(
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?/i,
      (_match, port = '') => `http://10.0.2.2${port}`
    );

    if (localhostUrl !== API_URL) {
      urls.push(localhostUrl);
    }

    if (emulatorUrl !== API_URL) {
      urls.push(emulatorUrl);
    }
  }

  return Array.from(new Set(urls));
};

const isNetworkRequestError = (error: unknown) =>
  error instanceof Error && /network request failed|failed to fetch|networkerror/i.test(error.message);

const createGlassAnalysisFormData = (photoUri: string) => {
  const filename = photoUri.split('/').pop() || 'photo.jpg';
  const ext = (filename.split('.').pop() || 'jpeg').toLowerCase();
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const formData = new FormData();

  formData.append('image', {
    uri: photoUri,
    name: filename,
    type: mimeType,
  } as any);

  return formData;
};

export const countGlassPanels = async (
  _base64Image: string,
  _mimeType: string,
  photoUri?: string
): Promise<BackendGlassAnalysisResponse> => {
  if (!photoUri) {
    throw new Error('Photo URI is required for backend Gemini image analysis.');
  }

  return withRetry(async () => {
    const urls = getGlassAnalysisBaseUrls();
    const failedUrls: string[] = [];
    let lastError: any = null;

    for (const baseUrl of urls) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      try {
        const response = await apiFetch(`${baseUrl}/api/ai/glass-analysis`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
          },
          body: createGlassAnalysisFormData(photoUri),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          qaDebug('Gemini analysis failed', { status: response.status });
          throw new Error(body?.message || `AI analysis failed (${response.status}).`);
        }

        const result = await response.json();
        qaDebug('Gemini analysis succeeded', {
          status: response.status,
          detectedCount: result?.ai_detected_count ?? result?.total_valid_panels,
        });
        return result;
      } catch (error) {
        lastError = error;
        failedUrls.push(baseUrl);

        if (!isNetworkRequestError(error) || baseUrl === urls[urls.length - 1]) {
          break;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (isNetworkRequestError(lastError)) {
      throw new Error(`Unable to reach BuildSphere backend for image analysis. Tried: ${failedUrls.join(', ')}`);
    }

    throw lastError;
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
    qaDebug('Gemini analysis failed', { status: 0 });
    console.error('GEMINI_BACKEND_AUDIT_ERROR:', error);
    throw new Error(`Gemini Audit Failed: ${error.message || 'Unknown Error'}`);
  }
};
