import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

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

export const countGlassPanels = async (base64Image: string, mimeType: string) => {
  console.log('DEBUG: High-Precision Coordinate Detection Mode Engaged');
  try {
    return await withRetry(async () => {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      // Using Bounding Box Detection Prompt for maximum accuracy
      const prompt = `
                You are a high-precision object detection system for BuildSphere construction audits.
                
                OBJECTIVE: Detect every INDIVIDUAL glass panel in the image.
                
                DETECTION RULES:
                1. Look for the physical frame of each glass pane.
                2. For mullioned/grid windows, count the large functional sections, NOT the decorative tiny internal squares.
                3. Return the bounding box for EACH panel in [ymin, xmin, ymax, xmax] format.
                
                Return ONLY JSON:
                {
                    "panels": [
                        {"label": "glass_panel", "box_2d": [ymin, xmin, ymax, xmax]},
                        ...
                    ],
                    "count": <total number of detected boxes>,
                    "explanation": "Summarize how you separated panels from reflections."
                }
            `;

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Image, mimeType: mimeType } },
      ]);

      const response = await result.response;
      let text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      
      const parsed = JSON.parse(text);
      
      // Ensure count is actually based on the length of panels array if not provided correctly
      if (parsed.panels && !parsed.count) {
        parsed.count = parsed.panels.length;
      }
      
      return parsed;
    });
  } catch (error: any) {
    console.error('DETECTION_ERROR:', error);
    if (error.message?.includes('429')) {
      throw new Error('QUOTA_LIMIT: Please wait 30 seconds.');
    }
    throw new Error(`AI_UNAVAILABLE: ${error.message}`);
  }
};

// ── CV Service Detection Types ──────────────────────────────────────
export interface CVDetection {
  bounding_box: number[];          // [x1, y1, x2, y2] in pixels
  confidence_score: number;        // 0.0 – 1.0
  label: string;                   // e.g. "full_glass_panel"
  polygon: number[][] | null;      // [[x,y], ...] from YOLOv8-seg, null for box mode
}

export interface CVAuditResult {
  count: number;                   // total_valid_panels
  summary: string;                 // AI-generated audit summary
  annotatedImage: string | null;   // base64 annotated JPEG
  detections: CVDetection[];       // per-panel detection list
  detectionMode: 'box' | 'segmentation' | 'gemini-fallback';
  avgConfidence: number;           // average confidence across detections
}

export const hybridGlassAudit = async (
  base64Image: string,
  mimeType: string,
  photoUri?: string
): Promise<CVAuditResult> => {
  console.log('DEBUG: Hybrid AI Audit Commencing (Local YOLO + Gemini)');
  
  // Use a stable tunnel URL for mobile-to-PC connection
  const CV_API_URL = "https://buildsphere-ai-audit.loca.lt/detect-panels";

  try {
    if (!photoUri) {
      throw new Error('Photo URI is required for local CV Service.');
    }

    console.log('DEBUG: Calling Local CV Service...');
    
    const formData = new FormData();
    const filename = photoUri.split('/').pop() || 'photo.jpg';
    
    formData.append('file', {
      uri: photoUri,
      name: filename,
      type: mimeType,
    } as any);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds

    const cvResponse = await fetch(CV_API_URL, {
      method: "POST",
      headers: {
        'Accept': 'application/json',
        'bypass-tunnel-reminder': 'true'
      },
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!cvResponse.ok) {
      const errText = await cvResponse.text();
      console.error('CV_API_ERROR:', cvResponse.status, errText);
      throw new Error(`CV Service Error (${cvResponse.status}): ${errText.substring(0, 100)}`);
    }

    const cvData = await cvResponse.json();

    const count: number = cvData.total_valid_panels || 0;
    const detections: CVDetection[] = cvData.detections || [];
    const detectionMode = cvData.detection_mode || 'box';
    const summary: string = cvData.summary_text
      || `Site Audit Complete. CV API detected ${count} valid panels.`;
    const annotatedImage: string | null = cvData.annotated_image_base64 || null;

    // Compute average confidence from detections
    const avgConfidence = detections.length > 0
      ? detections.reduce((sum, d) => sum + d.confidence_score, 0) / detections.length
      : 0;

    console.log(
      `DEBUG: CV Service returned ${count} panels, ` +
      `mode=${detectionMode}, avgConf=${avgConfidence.toFixed(3)}`
    );

    return {
      count,
      summary,
      annotatedImage,
      detections,
      detectionMode,
      avgConfidence,
    };

  } catch (error: any) {
    console.error('HYBRID_AUDIT_ERROR:', error);
    throw new Error(`Hybrid Audit Failed: ${error.message || 'Unknown Error'}`);
  }
};

export const getBuildsphereAI = async (p: string) => {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(p);
  return result.response.text();
};

export const analyzeBuildsphereImage = async (p: string, b: string, m: string) => {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent([p, { inlineData: { data: b, mimeType: m } }]);
  return result.response.text();
};

export default genAI;
