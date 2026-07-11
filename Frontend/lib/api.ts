/**
 * API helper
 *
 * Centralizes API base URL usage, Supabase/Auth token attachment, health checks,
 * and user-friendly connection errors for all mobile screens.
 */
export {
  API_URL,
  getApiRequestUrlCandidates,
  getApiConfigurationError,
  isLocalApiUrl,
  isTemporaryTunnelApiUrl,
} from './apiConfig';

import { API_URL, getApiRequestUrlCandidates, getApiUrlCandidates } from './apiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { qaDebug } from '../utils/qaDebug';

export const SERVER_UNREACHABLE_MESSAGE =
  'BuildSphere server is currently unreachable. Please try again later.';
export const SERVER_WAKING_MESSAGE =
  'Server may be waking up. Please try again in a few seconds.';
export const SERVER_OFFLINE_MESSAGE =
  'Unable to connect to the server. Please check your internet connection.';

export function getServerConnectionErrorMessage(error?: unknown) {
  try {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error ?? '');
    const normalized = `${name} ${message}`.toLowerCase();

    if (name === 'AbortError' || /timeout|aborted/.test(normalized)) {
      return SERVER_WAKING_MESSAGE;
    }

    if (/network request failed|failed to fetch|networkerror|unable to connect/.test(normalized)) {
      return SERVER_OFFLINE_MESSAGE;
    }

    return message || SERVER_UNREACHABLE_MESSAGE;
  } catch {
    return SERVER_WAKING_MESSAGE;
  }
}

export async function checkApiHealth(timeoutMs = 15000) {
  if (!API_URL) return false;

  for (const baseUrl of getApiUrlCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (response.status === 404) {
        response = await fetch(`${baseUrl}/`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const text = await response.text();
        return text.includes('BuildSphere API is running');
      }

      if (!response.ok) continue;

      const data = await response.json();
      qaDebug('API health check', { endpoint: '/health', status: response.status });
      return data?.status === 'ok' && data?.service === 'BuildSphere API';
    } catch (error) {
      qaDebug('API health check failed', { endpoint: '/health', status: 0 });
    } finally {
      clearTimeout(timeout);
    }
  }

  return false;
}

export async function loadStoredApiUrl() {
  return API_URL;
}

type UnauthorizedListener = () => void;
const listeners = new Set<UnauthorizedListener>();

export function addUnauthorizedListener(listener: UnauthorizedListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyUnauthorized() {
  listeners.forEach((listener) => listener());
}

function makeJsonResponse(data: unknown, status = 200): Response {
  const body = JSON.stringify(data ?? null);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    redirected: false,
    type: 'default',
    url: '',
    json: async () => data,
    text: async () => body,
    clone: () => makeJsonResponse(data, status),
  } as Response;
}

function pathAndQuery(input: string) {
  const withoutBase = input.startsWith(API_URL) ? input.slice(API_URL.length) : input;
  const [path, query = ''] = withoutBase.split('?');
  return {
    path: path || '/',
    params: new URLSearchParams(query),
  };
}

async function readStoredUser() {
  const stored = await AsyncStorage.getItem('user');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

async function supabaseRows(table: string, orderBy = 'created_at') {
  let result = await supabase.from(table).select('*').order(orderBy, { ascending: false });
  if (result.error) result = await supabase.from(table).select('*');
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data : [];
}

async function getProjectsFallback(path: string) {
  const mapProject = (project: any) => ({
    ...project,
    name:
      project.name ||
      project.project_name ||
      project.projectName ||
      project.project_title ||
      project.projectTitle ||
      project.title ||
      'Unnamed Project',
    location: project.location || project.address || 'Unknown Location',
    color: project.color || '#FFDFF2',
  });

  const detailMatch = path.match(/^\/projects\/(\d+)$/);
  if (detailMatch) {
    const rows = await supabaseRows('projects');
    const project = rows.find((row: any) => String(row.id) === detailMatch[1]);
    return project ? makeJsonResponse(mapProject(project)) : makeJsonResponse({ error: 'Project not found.' }, 404);
  }

  const activityMatch = path.match(/^\/projects\/(\d+)\/activity$/);
  if (activityMatch) return makeJsonResponse([]);

  const milestoneMatch = path.match(/^\/projects\/(\d+)\/milestone-plan$/);
  if (milestoneMatch) {
    const projectId = milestoneMatch[1];
    const [phases, milestones] = await Promise.all([
      supabase.from('project_phases').select('*').eq('project_id', projectId).order('sequence_no', { ascending: true }),
      supabase.from('project_milestones').select('*').eq('project_id', projectId).order('sequence_no', { ascending: true }),
    ]);

    const phaseRows = Array.isArray(phases.data) ? phases.data : [];
    const milestoneRows = Array.isArray(milestones.data) ? milestones.data : [];
    return makeJsonResponse({
      phases: phaseRows.map((phase: any) => ({
        ...phase,
        phase_title: phase.phase_title || phase.phase_name || phase.phase_key,
        milestones: milestoneRows.filter((milestone: any) => String(milestone.project_phase_id) === String(phase.id)),
      })),
    });
  }

  if (path === '/projects') return makeJsonResponse((await supabaseRows('projects')).map(mapProject));
  return null;
}

async function getTasksFallback(path: string) {
  const projects = await supabaseRows('projects').catch(() => []);
  const projectById = new Map(projects.map((project: any) => [String(project.id), project]));
  const mapTask = (task: any) => {
    const project = projectById.get(String(task.project_id));
    return {
      ...task,
      project: task.project || project?.name || project?.project_name || '',
      due_date: task.due_date || task.end_date || task.target_date || '',
      priority: task.priority || 'medium',
      status: task.status || 'pending',
    };
  };

  if (path === '/tasks/meta') {
    const [users, projectUsers] = await Promise.all([
      supabaseRows('users').catch(() => []),
      supabaseRows('project_user').catch(() => []),
    ]);
    return makeJsonResponse({
      projects: projects.map((project: any) => ({
        id: project.id,
        name: project.name || project.project_name || 'Unnamed Project',
      })),
      users: users.map((user: any) => ({
        id: user.id,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
        email: user.email,
        role: user.role,
      })),
      projectUsers,
    });
  }

  const projectTasksMatch = path.match(/^\/tasks\/project\/(\d+)$/);
  let tasks = await supabaseRows('tasks');
  if (projectTasksMatch) tasks = tasks.filter((task: any) => String(task.project_id) === projectTasksMatch[1]);
  if (path === '/tasks' || projectTasksMatch) return makeJsonResponse(tasks.map(mapTask));
  return null;
}

async function getNotificationsFallback(path: string) {
  if (path !== '/notifications') return null;
  const user = await readStoredUser();
  let rows = await supabaseRows('notifications').catch(() => []);
  if (user?.id) rows = rows.filter((row: any) => String(row.user_id) === String(user.id));
  return makeJsonResponse(rows);
}

async function getInventoryFallback(path: string, params: URLSearchParams) {
  const projectId = params.get('projectId') || params.get('project_id');
  if (path === '/inventory') {
    let rows = await supabaseRows('project_inventory_items');
    if (projectId) rows = rows.filter((row: any) => String(row.project_id) === String(projectId));
    return makeJsonResponse(rows.map((row: any) => ({
      ...row,
      quantity: row.quantity ?? row.current_stock ?? 0,
      current_stock: row.current_stock ?? row.quantity ?? 0,
      linked_task_ids: Array.isArray(row.linked_task_ids)
        ? row.linked_task_ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
        : [],
    })));
  }

  if (path === '/inventory/logs') {
    const [logs, items] = await Promise.all([
      supabaseRows('project_inventory_logs'),
      supabaseRows('project_inventory_items').catch(() => []),
    ]);
    const itemById = new Map(items.map((item: any) => [String(item.id), item]));
    let rows = logs;
    if (projectId) {
      rows = rows.filter((row: any) => String(itemById.get(String(row.item_id))?.project_id) === String(projectId));
    }
    return makeJsonResponse(rows.map((row: any) => ({
      ...row,
      item_name: row.item_name || itemById.get(String(row.item_id))?.item_name || '',
      unit: row.unit || itemById.get(String(row.item_id))?.unit || null,
    })));
  }

  return null;
}

async function getUserFallback(path: string) {
  const byEmailMatch = path.match(/^\/users\/by-email\/(.+)$/);
  if (byEmailMatch) {
    const email = decodeURIComponent(byEmailMatch[1]).toLowerCase();
    const rows = await supabaseRows('users').catch(() => []);
    const user = rows.find((row: any) => String(row.email || '').toLowerCase() === email);
    return user ? makeJsonResponse(user) : null;
  }

  const userMatch = path.match(/^\/(?:api\/)?users\/(\d+)$/);
  if (userMatch) {
    const rows = await supabaseRows('users').catch(() => []);
    const user = rows.find((row: any) => String(row.id) === userMatch[1]);
    return user ? makeJsonResponse(user) : null;
  }

  return null;
}

async function trySupabaseGetFallback(input: string, method: string) {
  if (String(method || 'GET').toUpperCase() !== 'GET') return null;

  const { path, params } = pathAndQuery(input);
  try {
    return (
      (await getProjectsFallback(path)) ||
      (await getTasksFallback(path)) ||
      (await getNotificationsFallback(path)) ||
      (await getInventoryFallback(path, params)) ||
      (await getUserFallback(path))
    );
  } catch (error) {
    qaDebug('Supabase fallback failed', {
      endpoint: path,
      reason: error instanceof Error ? error.message : 'fallback-error',
    });
    return null;
  }
}

export async function getSupabaseAccessToken() {
  // Supabase session is preferred for most calls; AsyncStorage token remains as a fallback for older sessions.
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  return AsyncStorage.getItem('token');
}

async function getAuthTokenCandidates() {
  const tokens: string[] = [];

  const { data } = await supabase.auth.getSession();
  const supabaseToken = data.session?.access_token || '';
  const storedToken = (await AsyncStorage.getItem('token')) || '';

  if (isBackendAuthToken(storedToken)) tokens.push(storedToken);
  if (supabaseToken && !tokens.includes(supabaseToken)) tokens.push(supabaseToken);
  if (storedToken && !tokens.includes(storedToken)) tokens.push(storedToken);

  return tokens;
}

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isBackendAuthToken(token?: string | null) {
  const payload = token ? decodeJwtPayload(token) : null;
  return Boolean(payload?.userId && payload?.email);
}

function setBearerToken(headers: Headers, token?: string) {
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.delete('Authorization');
  }
}

async function attachMobileSessionHeaders(headers: Headers) {
  const user = await readStoredUser();
  if (!user || typeof user !== 'object') return;

  const id = user.id ?? user.userId;
  const email = user.email;
  const role = user.role;

  if (id !== undefined && id !== null && !headers.has('X-BuildSphere-Mobile-User-Id')) {
    headers.set('X-BuildSphere-Mobile-User-Id', String(id));
  }
  if (email && !headers.has('X-BuildSphere-Mobile-User-Email')) {
    headers.set('X-BuildSphere-Mobile-User-Email', String(email));
  }
  if (role && !headers.has('X-BuildSphere-Mobile-User-Role')) {
    headers.set('X-BuildSphere-Mobile-User-Role', String(role));
  }
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const baseHeaders = new Headers(init.headers || {});
  const explicitAuthorization = baseHeaders.has('Authorization');
  const tokenCandidates = explicitAuthorization ? [] : await getAuthTokenCandidates();
  const headers = new Headers(baseHeaders);

  if (!explicitAuthorization) {
    // Mobile uses the backend as the source of truth, so protected calls carry auth.
    setBearerToken(headers, tokenCandidates[0]);
  }
  await attachMobileSessionHeaders(headers);

  const method = init.method || 'GET';
  const endpoint = typeof input === 'string' ? input.replace(API_URL, '') : 'unknown';
  const candidateUrls = getApiRequestUrlCandidates(input);
  let lastError: unknown = null;

  for (const requestUrl of candidateUrls) {
    try {
      let response = await fetch(requestUrl, {
        ...init,
        headers,
      });

      qaDebug('API request', {
        method,
        endpoint,
        status: response.status,
        authenticated: headers.has('Authorization'),
      });

      if (response.status === 401 && !explicitAuthorization && tokenCandidates.length > 1) {
        for (const retryToken of tokenCandidates.slice(1)) {
          const retryHeaders = new Headers(baseHeaders);
          setBearerToken(retryHeaders, retryToken);
          await attachMobileSessionHeaders(retryHeaders);

          const retryResponse = await fetch(requestUrl, {
            ...init,
            headers: retryHeaders,
          });

          qaDebug('API request auth retry', {
            method,
            endpoint,
            status: retryResponse.status,
            authenticated: retryHeaders.has('Authorization'),
          });

          if (retryResponse.status !== 401) return retryResponse;
          response = retryResponse;
        }
      }

      if (!response.ok) {
        const fallback = await trySupabaseGetFallback(input, method);
        if (fallback) return fallback;
      }

      return response;
    } catch (error) {
      lastError = error;
      qaDebug('API request failed', {
        method,
        endpoint,
        status: 0,
        authenticated: headers.has('Authorization'),
        reason: error instanceof Error ? error.message : 'network-error',
      });
    }
  }

  const fallback = await trySupabaseGetFallback(input, method);
  if (fallback) return fallback;

  throw lastError;
}

