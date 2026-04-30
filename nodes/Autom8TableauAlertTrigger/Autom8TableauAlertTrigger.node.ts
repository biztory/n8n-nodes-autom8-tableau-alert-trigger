import {
	IPollFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IDataObject,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import {
	parseCsvToJson,
	tableauViewDataCsv,
	vizqlQueryDatasource,
} from './shared/transport';
import type { TableauCredentials } from './shared/types';

type ComparisonOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

function compare(a: number, operator: ComparisonOperator, b: number): boolean {
	switch (operator) {
		case 'gt': return a > b;
		case 'gte': return a >= b;
		case 'lt': return a < b;
		case 'lte': return a <= b;
		case 'eq': return a === b;
		case 'neq': return a !== b;
	}
}

export class Autom8TableauAlertTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Autom8 Tableau - Data Alert Trigger',
		name: 'autom8TableauAlertTrigger',
		icon: {
			light: 'file:../../icons/autom8-alert-light.svg',
			dark: 'file:../../icons/autom8-alert-dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["source"] === "view" ? "View: " + $parameter["viewId"] : "Datasource: " + $parameter["datasourceLuid"]}}',
		description:
			'Monitors data in a Tableau view or datasource on a schedule and fires when a condition is met.',
		usableAsTool: true,
		defaults: {
			name: 'Autom8 Tableau - Data Alert Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'autom8TableauConnectedAppApi',
				required: true,
			},
		],
		properties: [
			// ── Source selection ─────────────────────────────────────────────
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Datasource (VizQL)',
						value: 'datasource',
						description:
							'Query a published datasource via the VizQL Data Service',
					},
					{
						name: 'View',
						value: 'view',
						description: 'Query the CSV data exposed by a Tableau view',
					},
				],
				default: 'view',
				description: 'The Tableau object to pull data from on each poll',
			},

			// ── View source ──────────────────────────────────────────────────
			{
				displayName: 'View ID',
				name: 'viewId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { source: ['view'] } },
				description: 'The LUID of the Tableau view to query',
			},
			{
				displayName: 'Variable Filters',
				name: 'vfFilters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { source: ['view'] } },
				description: 'Optional vf_&lt;fieldname&gt;=value filters applied to the view before data is returned',
				options: [
					{
						displayName: 'Filter',
						name: 'filter',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: '',
								placeholder: 'e.g. Region',
								description: 'The name of the field to filter on',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'e.g. West',
								description: 'The filter value',
							},
						],
					},
				],
			},

			// ── Datasource source ────────────────────────────────────────────
			{
				displayName: 'Datasource ID',
				name: 'datasourceLuid',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { source: ['datasource'] } },
				description: 'The LUID of the Tableau datasource to query',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'json',
				default: '{\n  "fields": [\n    { "fieldCaption": "Category" }\n  ]\n}',
				required: true,
				displayOptions: { show: { source: ['datasource'] } },
				description:
					'The VizQL Data Service query object (fields, filters, parameters). See Tableau docs for the full schema.',
			},

			// ── Condition ────────────────────────────────────────────────────
			{
				displayName: 'Condition',
				name: 'conditionType',
				type: 'options',
				noDataExpression: true,
				default: 'anyRows',
				options: [
					{
						name: 'Any Rows Returned',
						value: 'anyRows',
						description: 'Fire whenever the query returns at least one row',
					},
					{
						name: 'Row Count Threshold',
						value: 'rowCount',
						description:
							'Compare the number of returned rows against a numeric threshold',
					},
				],
				description:
					'How to decide whether the poll should fire the workflow (keep simple for v1)',
			},
			{
				displayName: 'Operator',
				name: 'operator',
				type: 'options',
				default: 'gt',
				displayOptions: { show: { conditionType: ['rowCount'] } },
				options: [
					{ name: '!= (Not Equal)', value: 'neq' },
					{ name: '< (Less Than)', value: 'lt' },
					{ name: '<= (Less or Equal)', value: 'lte' },
					{ name: '= (Equal)', value: 'eq' },
					{ name: '> (Greater Than)', value: 'gt' },
					{ name: '>= (Greater or Equal)', value: 'gte' },
				],
			},
			{
				displayName: 'Threshold',
				name: 'threshold',
				type: 'number',
				default: 0,
				displayOptions: { show: { conditionType: ['rowCount'] } },
				description: 'The numeric threshold to compare the row count against',
			},

			// ── Output ───────────────────────────────────────────────────────
			{
				displayName: 'Emit',
				name: 'emitMode',
				type: 'options',
				default: 'rows',
				options: [
					{
						name: 'One Item per Row',
						value: 'rows',
						description: 'Emit each returned row as a separate workflow item',
					},
					{
						name: 'Single Summary Item',
						value: 'summary',
						description:
							'Emit a single item containing the row count and all rows under a "rows" key',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = (await this.getCredentials(
			'autom8TableauConnectedAppApi',
		)) as unknown as TableauCredentials;

		const source = this.getNodeParameter('source') as 'view' | 'datasource';
		const conditionType = this.getNodeParameter('conditionType') as
			| 'anyRows'
			| 'rowCount';
		const emitMode = this.getNodeParameter('emitMode') as 'rows' | 'summary';

		// ── 1. Fetch rows from the configured source ──────────────────────────
		let rows: IDataObject[];
		try {
			if (source === 'view') {
				const viewId = this.getNodeParameter('viewId') as string;
				const vfFilters = this.getNodeParameter('vfFilters', {}) as {
					filter?: Array<{ fieldName: string; value: string }>;
				};
				const qs: IDataObject = {};
				for (const { fieldName, value } of vfFilters.filter ?? []) {
					if (fieldName) qs[`vf_${fieldName}`] = value;
				}
				const csv = await tableauViewDataCsv(this, credentials, viewId, qs);
				rows = parseCsvToJson(csv);
			} else {
				const datasourceLuid = this.getNodeParameter('datasourceLuid') as string;
				const queryRaw = this.getNodeParameter('query') as string | IDataObject;
				const query =
					typeof queryRaw === 'string'
						? (JSON.parse(queryRaw) as IDataObject)
						: queryRaw;
				rows = await vizqlQueryDatasource(this, credentials, {
					datasource: { datasourceLuid },
					query,
				});
			}
		} catch (err) {
			throw new NodeOperationError(
				this.getNode(),
				`Autom8 Data Alert (Tableau): failed to fetch data from Tableau. ${
					err instanceof Error ? err.message : 'Unknown error'
				}`,
			);
		}

		// ── 2. Evaluate the condition ─────────────────────────────────────────
		let fire: boolean;
		if (conditionType === 'anyRows') {
			fire = rows.length > 0;
		} else {
			const operator = this.getNodeParameter('operator') as ComparisonOperator;
			const threshold = this.getNodeParameter('threshold') as number;
			fire = compare(rows.length, operator, threshold);
		}

		if (!fire) return null;

		// ── 3. Emit data in the chosen shape ──────────────────────────────────
		if (emitMode === 'summary') {
			const summary: IDataObject = {
				row_count: rows.length,
				triggered_at: new Date().toISOString(),
				source,
				rows,
			};
			return [[{ json: summary }]];
		}

		return [rows.map((row) => ({ json: row }))];
	}
}
