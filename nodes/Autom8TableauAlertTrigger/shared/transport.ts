import { createHmac, randomUUID } from 'crypto';
import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import type { TableauAuthToken, TableauCredentials, TableauRequestContext } from './types';

const TABLEAU_AUTH_CACHE_KEY = 'autom8TableauAlertTriggerAuth';
const TOKEN_EXPIRY_BUFFER_MINUTES = 10;
const TOKEN_LIFETIME_MINUTES = 240;

function base64url(data: string): string {
	return Buffer.from(data).toString('base64url');
}

function signJwt(credentials: TableauCredentials): string {
	const { clientId, secretId, secretValue, username, scopes } = credentials;

	const scopeList = scopes
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	const header = base64url(
		JSON.stringify({ alg: 'HS256', kid: secretId, iss: clientId }),
	);

	const now = Math.floor(Date.now() / 1000);
	const payload = base64url(
		JSON.stringify({
			iss: clientId,
			sub: username,
			aud: 'tableau',
			iat: now,
			exp: now + 300,
			jti: randomUUID(),
			scp: scopeList,
		}),
	);

	const signature = createHmac('sha256', secretValue)
		.update(`${header}.${payload}`)
		.digest('base64url');

	return `${header}.${payload}.${signature}`;
}

async function authenticate(
	context: TableauRequestContext,
	credentials: TableauCredentials,
): Promise<TableauAuthToken> {
	const { serverUrl, siteContentUrl, apiVersion } = credentials;
	const jwt = signJwt(credentials);

	const baseUrl = serverUrl.replace(/\/+$/, '');
	const signInUrl = `${baseUrl}/api/${apiVersion}/auth/signin`;

	let response: { credentials: { token: string; site: { id: string; contentUrl: string }; user: { id: string } } };
	try {
		response = (await context.helpers.httpRequest({
			method: 'POST',
			url: signInUrl,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: {
				credentials: {
					jwt,
					site: { contentUrl: siteContentUrl },
				},
			},
			json: true,
		})) as typeof response;
	} catch (error) {
		const tableau = parseTableauError(error);
		if (tableau) throw new Error(`Tableau sign-in failed — ${buildTableauErrorMessage(tableau)}`);
		throw new Error(`Tableau sign-in request failed: ${(error as Error).message ?? error}`);
	}

	return {
		token: response.credentials.token,
		siteId: response.credentials.site.id,
		expiresAt:
			Date.now() +
			(TOKEN_LIFETIME_MINUTES - TOKEN_EXPIRY_BUFFER_MINUTES) * 60 * 1000,
	};
}

async function getAuthToken(
	context: TableauRequestContext,
	credentials: TableauCredentials,
): Promise<TableauAuthToken> {
	const staticData = context.getWorkflowStaticData('global');
	const cached = staticData[TABLEAU_AUTH_CACHE_KEY] as TableauAuthToken | undefined;

	if (cached && cached.expiresAt > Date.now()) {
		return cached;
	}

	const authToken = await authenticate(context, credentials);
	staticData[TABLEAU_AUTH_CACHE_KEY] = authToken as unknown as IDataObject;
	return authToken;
}

function invalidateAuthToken(context: TableauRequestContext): void {
	const staticData = context.getWorkflowStaticData('global');
	delete staticData[TABLEAU_AUTH_CACHE_KEY];
}

interface TableauErrorBody {
	code: string;
	summary: string;
	detail: string;
}

function parseTableauError(error: unknown): TableauErrorBody | undefined {
	try {
		const data = (error as Record<string, Record<string, unknown>>).response?.data;

		// When encoding:'arraybuffer' is used, the error body is a Buffer/ArrayBuffer.
		// Try to decode it as UTF-8 JSON so we can extract the Tableau error structure.
		let resolved: Record<string, unknown> | undefined;
		if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
			try {
				resolved = JSON.parse(Buffer.from(data as ArrayBuffer).toString('utf-8')) as Record<string, unknown>;
			} catch {
				return undefined;
			}
		} else {
			resolved = data as Record<string, unknown> | undefined;
		}

		const body = resolved?.error;
		if (!body || typeof body !== 'object') return undefined;
		const { code, summary, detail } = body as Record<string, unknown>;
		if (typeof code !== 'string') return undefined;
		return {
			code,
			summary: typeof summary === 'string' ? summary : 'Unknown error',
			detail: typeof detail === 'string' ? detail : '',
		};
	} catch {
		return undefined;
	}
}

function buildTableauErrorMessage(error: TableauErrorBody): string {
	const detail = error.detail ? ` — ${error.detail}` : '';
	return `Tableau error ${error.code}: ${error.summary}${detail}`;
}

async function withAuthRetry<T>(
	context: TableauRequestContext,
	credentials: TableauCredentials,
	makeRequest: (authToken: TableauAuthToken) => Promise<T>,
): Promise<T> {
	let authToken = await getAuthToken(context, credentials);

	try {
		return await makeRequest(authToken);
	} catch (error) {
		const tableau = parseTableauError(error);

		if (tableau) {
			if (tableau.code === '401000') {
				invalidateAuthToken(context);
				authToken = await getAuthToken(context, credentials);
				return await makeRequest(authToken);
			}
			throw new Error(buildTableauErrorMessage(tableau));
		}
		throw error;
	}
}

function siteUrl(
	credentials: TableauCredentials,
	authToken: TableauAuthToken,
	endpoint: string,
): string {
	return `${credentials.serverUrl.replace(/\/+$/, '')}/api/${credentials.apiVersion}/sites/${authToken.siteId}${endpoint}`;
}

function vizqlUrl(credentials: TableauCredentials, endpoint: string): string {
	return `${credentials.serverUrl.replace(/\/+$/, '')}/api/v1/vizql-data-service/${endpoint}`;
}

/**
 * GET a view's CSV data via the REST API.
 */
export async function tableauViewDataCsv(
	context: TableauRequestContext,
	credentials: TableauCredentials,
	viewId: string,
	qs: IDataObject = {},
): Promise<Buffer> {
	return withAuthRetry(context, credentials, async (authToken) => {
		const response = await context.helpers.httpRequest({
			method: 'GET',
			url: siteUrl(credentials, authToken, `/views/${viewId}/data`),
			headers: { 'X-Tableau-Auth': authToken.token },
			qs,
			returnFullResponse: true,
			encoding: 'arraybuffer',
		} as IHttpRequestOptions);
		return Buffer.from((response as { body: ArrayBuffer }).body);
	});
}

/**
 * POST to the VizQL Data Service query-datasource endpoint.
 */
export async function vizqlQueryDatasource(
	context: TableauRequestContext,
	credentials: TableauCredentials,
	body: IDataObject,
): Promise<IDataObject[]> {
	return withAuthRetry(context, credentials, async (authToken) => {
		const response = (await context.helpers.httpRequest({
			method: 'POST',
			url: vizqlUrl(credentials, 'query-datasource'),
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'X-Tableau-Auth': authToken.token,
			},
			body,
			json: true,
		})) as { data?: IDataObject[] } | IDataObject[];

		if (Array.isArray(response)) return response;
		return response.data ?? [];
	});
}

// ---------------------------------------------------------------------------
// Minimal RFC-4180 CSV parser — enough for the CSV Tableau returns.
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			result.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

export function parseCsvToJson(buffer: Buffer): IDataObject[] {
	const lines = buffer.toString('utf-8').split(/\r?\n/);
	if (lines.length < 2) return [];
	const headers = parseCsvLine(lines[0]);
	const rows: IDataObject[] = [];
	for (let i = 1; i < lines.length; i++) {
		if (!lines[i].trim()) continue;
		const values = parseCsvLine(lines[i]);
		const obj: IDataObject = {};
		headers.forEach((h, idx) => {
			obj[h] = values[idx] ?? '';
		});
		rows.push(obj);
	}
	return rows;
}
