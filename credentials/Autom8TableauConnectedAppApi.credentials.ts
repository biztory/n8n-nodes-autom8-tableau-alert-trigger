import { createHmac, randomUUID } from 'crypto';
import type {
	IAuthenticate,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

function base64url(data: string): string {
	return Buffer.from(data).toString('base64url');
}

function signJwt(credentials: {
	clientId: string;
	secretId: string;
	secretValue: string;
	username: string;
	scopes: string;
}): string {
	const scopeList = credentials.scopes
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	const header = base64url(
		JSON.stringify({ alg: 'HS256', kid: credentials.secretId, iss: credentials.clientId }),
	);
	const now = Math.floor(Date.now() / 1000);
	const payload = base64url(
		JSON.stringify({
			iss: credentials.clientId,
			sub: credentials.username,
			aud: 'tableau',
			iat: now,
			exp: now + 300,
			jti: randomUUID(),
			scp: scopeList,
		}),
	);
	const signature = createHmac('sha256', credentials.secretValue)
		.update(`${header}.${payload}`)
		.digest('base64url');

	return `${header}.${payload}.${signature}`;
}

export class Autom8TableauConnectedAppApi implements ICredentialType {
	name = 'autom8TableauConnectedAppApi';

	displayName = 'Autom8 Tableau – Connected App API';

	icon: Icon = 'file:../icons/tableau.svg';

	documentationUrl =
		'https://help.tableau.com/current/online/en-us/connected_apps_direct.htm';

	authenticate: IAuthenticate = async (
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> => {
		// /serverinfo is a public endpoint that explicitly rejects scoped session
		// tokens. Return the request unmodified so the credential test can reach it.
		if (typeof requestOptions.url === 'string' && requestOptions.url.endsWith('/serverinfo')) {
			return requestOptions;
		}

		const baseUrl = (credentials.serverUrl as string).replace(/\/+$/, '');
		const jwt = signJwt(credentials as {
			clientId: string;
			secretId: string;
			secretValue: string;
			username: string;
			scopes: string;
		});

		const signInResponse = await fetch(
			`${baseUrl}/api/${credentials.apiVersion as string}/auth/signin`,
			{
				method: 'POST',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify({
					credentials: { jwt, site: { contentUrl: credentials.siteContentUrl } },
				}),
			},
		);

		if (!signInResponse.ok) {
			const text = await signInResponse.text();
			throw new Error(`Tableau authentication failed (${signInResponse.status}): ${text}`);
		}

		const data = (await signInResponse.json()) as { credentials?: { token?: string } };
		const token = data.credentials?.token;
		if (!token) {
			throw new Error('Tableau authentication: no token returned from sign-in endpoint');
		}

		return {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				'X-Tableau-Auth': token,
			},
		};
	};

	// Tests server connectivity and that the API version is valid.
	// Full JWT auth is verified on first actual use — the authenticate hook
	// above short-circuits for /serverinfo so the test hits the public endpoint cleanly.
	test: ICredentialTestRequest = {
		request: {
			url: '={{$credentials.serverUrl.replace(/\\/+$/, "") + "/api/" + $credentials.apiVersion + "/serverinfo"}}',
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://10ax.online.tableau.com',
			description:
				'The URL of your Tableau Server or Tableau Cloud site (e.g. https://10ax.online.tableau.com)',
		},
		{
			displayName: 'Site Content URL',
			name: 'siteContentUrl',
			type: 'string',
			default: '',
			placeholder: 'my-site',
			description:
				'The content URL of the site (the value after /site/ in the URL). Leave empty for the default site.',
		},
		{
			displayName: 'Connected App Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'The Client ID of the Tableau Connected App',
		},
		{
			displayName: 'Connected App Secret ID',
			name: 'secretId',
			type: 'string',
			default: '',
			required: true,
			description: 'The Secret ID (key identifier) generated for the Connected App',
		},
		{
			displayName: 'Connected App Secret Value',
			name: 'secretValue',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The Secret Value used to sign the JWT',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'user@example.com',
			description: 'The Tableau username (email) to authenticate as',
		},
		{
			displayName: 'API Version',
			name: 'apiVersion',
			type: 'string',
			default: '3.24',
			description: 'The Tableau REST API version to use',
		},
		{
			displayName: 'Scopes',
			name: 'scopes',
			type: 'string',
			default: 'tableau:content:read,tableau:views:download,tableau:viz_data_service:read',
			description:
				'Comma-separated list of scopes for the JWT. Must cover the data access the Alert Trigger node performs.',
		},
	];
}
