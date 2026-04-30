import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

export interface TableauCredentials {
	serverUrl: string;
	siteContentUrl: string;
	clientId: string;
	secretId: string;
	secretValue: string;
	username: string;
	apiVersion: string;
	scopes: string;
}

export interface TableauAuthToken {
	token: string;
	siteId: string;
	expiresAt: number;
}

/**
 * Minimal context surface needed for authenticated Tableau requests.
 * Satisfied by IPollFunctions, IExecuteFunctions, and ILoadOptionsFunctions.
 */
export interface TableauRequestContext {
	helpers: { httpRequest(options: IHttpRequestOptions): Promise<unknown> };
	getWorkflowStaticData(type: 'global' | 'node'): IDataObject;
}
